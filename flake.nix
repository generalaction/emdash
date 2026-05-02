{
  description = "Nix dev shell for the Emdash Electron workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};
      lib = pkgs.lib;
      packageJson = builtins.fromJSON (builtins.readFile ./package.json);
      pnpmPackageManager = packageJson.packageManager or "";
      pnpmVersionMatch = builtins.match "pnpm@([0-9]+\\.[0-9]+\\.[0-9]+)(\\+.*)?" pnpmPackageManager;
      requiredPnpmVersion =
        if pnpmVersionMatch != null
        then builtins.elemAt pnpmVersionMatch 0
        else throw "package.json must define packageManager as pnpm@<version> (optionally with +suffix)";
      # Nixpkgs can lag patch releases; require matching major/minor line (e.g. 10.28.x).
      requiredPnpmMajorMinor = builtins.elemAt (builtins.match "([0-9]+\\.[0-9]+)\\..*" requiredPnpmVersion) 0;
      requiredPnpmCompatVersion = "${requiredPnpmMajorMinor}.0";
      requiredPnpmMajor = builtins.elemAt (builtins.match "([0-9]+)\\..*" requiredPnpmVersion) 0;
      requiredPnpmAttr = "pnpm_" + requiredPnpmMajor;
      majorPnpm =
        if builtins.hasAttr requiredPnpmAttr pkgs
        then builtins.getAttr requiredPnpmAttr pkgs
        else null;
      nodejs = pkgs.nodejs_22;
      pnpmBase =
        if majorPnpm != null && lib.versionAtLeast majorPnpm.version requiredPnpmCompatVersion
        then majorPnpm
        else if pkgs ? pnpm && lib.versionAtLeast pkgs.pnpm.version requiredPnpmCompatVersion
        then pkgs.pnpm
        else
          throw "Nixpkgs pnpm is too old for this repo. Required >= ${requiredPnpmCompatVersion} (matching packageManager ${requiredPnpmVersion} major/minor), but found pnpm=${
            if pkgs ? pnpm
            then pkgs.pnpm.version
            else "missing"
          } ${requiredPnpmAttr}=${
            if builtins.hasAttr requiredPnpmAttr pkgs
            then (builtins.getAttr requiredPnpmAttr pkgs).version
            else "missing"
          }.";
      pnpm =
        if pnpmBase ? override
        then pnpmBase.override {inherit nodejs;}
        else pnpmBase;

      # Electron version must match package.json
      electronVersion = "40.7.0";

      # Pre-fetch Electron binary for Linux x64
      # electron-builder expects zips named: electron-v${version}-linux-x64.zip
      electronLinuxZip = pkgs.fetchurl {
        url = "https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-linux-x64.zip";
        sha256 = "sha256-D3utkbADhMTStZ6++QRBW+lb8G7b/llfD8tX9R/RR+Q=";
      };

      # Create a directory with the electron zip for electronDist
      electronDistDir = pkgs.runCommand "electron-dist" {} ''
        mkdir -p $out
        cp ${electronLinuxZip} $out/electron-v${electronVersion}-linux-x64.zip
      '';

      # Pre-fetch Electron node headers so @electron/rebuild can compile
      # native modules without network access in the sandbox
      electronHeaders = pkgs.fetchurl {
        url = "https://www.electronjs.org/headers/v${electronVersion}/node-v${electronVersion}-headers.tar.gz";
        sha256 = "sha256-M+UG5J/dCUxVE0lzNeMl4IP7nJs1WwvAtSyFfApbUR4=";
      };

      # Extract headers into a directory node-gyp expects
      electronHeadersDir = pkgs.runCommand "electron-headers" {} ''
        mkdir -p $out
        tar xzf ${electronHeaders} -C $out --strip-components=1
      '';

      sharedEnv =
        [
          nodejs
          pkgs.git
          pkgs.python3
          pkgs.pkg-config
          pkgs.openssl
          pkgs.libtool
          pkgs.autoconf
          pkgs.automake
          pkgs.coreutils
        ]
        ++ lib.optionals pkgs.stdenv.isDarwin [
          pkgs.libiconv
        ]
        ++ lib.optionals pkgs.stdenv.isLinux [
          pkgs.libsecret
          pkgs.sqlite
          pkgs.zlib
          pkgs.libutempter
          pkgs.patchelf
        ];
      cleanSrc = lib.cleanSource ./.;
      emdashPackage =
        if pkgs.stdenv.isLinux
        then
          pkgs.stdenv.mkDerivation rec {
            pname = "emdash";
            version = packageJson.version;
            src = cleanSrc;
            pnpmDeps =
              if pkgs ? fetchPnpmDeps
              then
                pkgs.fetchPnpmDeps {
                  inherit pname version src;
                  inherit pnpm;
                  fetcherVersion = 1;
                  hash = "sha256-CqS39LSztynmS12Gifdo1OmlttiYnBfXphwlscrED9Y=";
                }
              else
                pnpm.fetchDeps {
                  inherit pname version src;
                  fetcherVersion = 1;
                  hash = "";
                };
            nativeBuildInputs =
              sharedEnv
              ++ [
                pnpm
                (pkgs.pnpmConfigHook or pnpm.configHook)
                pkgs.dpkg
                pkgs.rpm
                pkgs.autoPatchelfHook
                pkgs.makeWrapper
              ];
            buildInputs = [
              pkgs.libsecret
              pkgs.sqlite
              pkgs.zlib
              pkgs.libutempter
              # Electron runtime dependencies
              pkgs.alsa-lib
              pkgs.at-spi2-atk
              pkgs.cairo
              pkgs.cups
              pkgs.dbus
              pkgs.expat
              pkgs.gdk-pixbuf
              pkgs.glib
              pkgs.gtk3
              pkgs.libdrm
              pkgs.libGL
              pkgs.libxkbcommon
              pkgs.mesa
              pkgs.nspr
              pkgs.nss
              pkgs.pango
              pkgs.gsettings-desktop-schemas
              pkgs.libglvnd
              pkgs.libx11
              pkgs.libxcomposite
              pkgs.libxdamage
              pkgs.libxext
              pkgs.libxfixes
              pkgs.libxrandr
              pkgs.libxcb
            ];
            env = {
              HOME = "$TMPDIR/emdash-home";
              npm_config_build_from_source = "true";
              npm_config_manage_package_manager_versions = "false";
              # Skip Electron binary download during pnpm install
              ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              # Skip postinstall electron-rebuild (we run it manually in buildPhase)
              EMDASH_SKIP_ELECTRON_REBUILD = "1";
              # Point node-gyp at pre-fetched Electron headers (no network needed)
              npm_config_nodedir = "${electronHeadersDir}";
            };

            buildPhase = ''
              runHook preBuild

              mkdir -p "$TMPDIR/emdash-home"
              pnpm config set manage-package-manager-versions false

              # cpu-features is an optional dep of ssh2 whose native build requires
              # a git submodule that isn't populated in the npm tarball. Remove it
              # so electron-rebuild doesn't try (and fail) to compile it.
              rm -rf node_modules/cpu-features

              # Rebuild native modules for Electron (postinstall is skipped via
              # EMDASH_SKIP_ELECTRON_REBUILD because pnpmConfigHook may not
              # preserve rebuilt .node files)
              pnpm exec electron-rebuild -f --only=better-sqlite3,node-pty

              # Build the app (renderer + main)
              pnpm run build

              # Run electron-builder with electronDist override to avoid download
              # Use --dir to only produce unpacked output (no AppImage/deb which require network)
              pnpm exec electron-builder --linux --dir \
                --config electron-builder.config.ts \
                -c.electronDist=${electronDistDir}

              runHook postBuild
            '';

            installPhase = ''
                              runHook preInstall

                              # electron-builder outputs to "release" directory (configured in package.json build.directories.output)
                              distDir="$PWD/release"
                              unpackedDir="$distDir/linux-unpacked"

                              if [ ! -d "$unpackedDir" ]; then
                                echo "Expected linux-unpacked output from electron-builder, got nothing at $unpackedDir" >&2
                                exit 1
                              fi

                              install -d $out/share/emdash
                              cp -R "$unpackedDir" $out/share/emdash/

                              if ls "$distDir"/*.AppImage >/dev/null 2>&1; then
                                for image in "$distDir"/*.AppImage; do
                                  install -Dm755 "$image" "$out/share/emdash/$(basename "$image")"
                                done
                              fi

                              install -d $out/bin

                              # Wrap the binary with LD_LIBRARY_PATH for libraries that
                              # Electron loads via dlopen (not caught by autoPatchelfHook)
                              makeWrapper "$out/share/emdash/linux-unpacked/emdash" "$out/bin/emdash" \
                                --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [
                                  pkgs.libglvnd
                                  pkgs.mesa
                                  pkgs.libGL
                                ]}" \
                                --prefix GSETTINGS_SCHEMA_DIR : "${pkgs.gsettings-desktop-schemas}/share/glib-2.0/schemas"

                              runHook postInstall
            '';

            meta = {
              description = "Emdash – multi-agent orchestration desktop app";
              homepage = "https://emdash.sh";
              license = lib.licenses.asl20;
              platforms = ["x86_64-linux"];
            };
          }
        else
          pkgs.writeShellScriptBin "emdash" ''
            echo "The packaged Emdash app is currently only available for Linux when using Nix." >&2
            exit 1
          '';
    in {
      devShells.default = pkgs.mkShell {
        packages = sharedEnv;

        shellHook = ''
          echo "Emdash dev shell ready"
          echo "Node: $(node --version)"
          echo "Run 'pnpm run d' for the full dev loop."
        '';
      };

      packages.emdash = emdashPackage;
      packages.default = emdashPackage;

      apps.default = {
        type = "app";
        program = "${emdashPackage}/bin/emdash";
      };
    });
}
