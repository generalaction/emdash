{
  description = "Nix dev shell for the Emdash Electron workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { localSystem = system; };
        lib = pkgs.lib;
        packageJson = builtins.fromJSON (builtins.readFile ./package.json);
        pnpmPackageManager = packageJson.packageManager or "";
        pnpmVersionMatch = builtins.match "pnpm@([0-9]+\\.[0-9]+\\.[0-9]+)(\\+.*)?" pnpmPackageManager;
        requiredPnpmVersion =
          if pnpmVersionMatch != null then
            builtins.elemAt pnpmVersionMatch 0
          else
            throw "package.json must define packageManager as pnpm@<version> (optionally with +suffix)";
        # Nixpkgs can lag patch releases; require matching major/minor line (e.g. 10.28.x).
        requiredPnpmMajorMinor = builtins.elemAt (builtins.match "([0-9]+\\.[0-9]+)\\..*" requiredPnpmVersion) 0;
        requiredPnpmCompatVersion = "${requiredPnpmMajorMinor}.0";
        requiredPnpmMajor = builtins.elemAt (builtins.match "([0-9]+)\\..*" requiredPnpmVersion) 0;
        requiredPnpmAttr = "pnpm_" + requiredPnpmMajor;
        majorPnpm =
          if builtins.hasAttr requiredPnpmAttr pkgs then
            builtins.getAttr requiredPnpmAttr pkgs
          else
            null;
        nodejs = pkgs.nodejs_22;
        pnpmBase =
          if majorPnpm != null && lib.versionAtLeast majorPnpm.version requiredPnpmCompatVersion then
            majorPnpm
          else if pkgs ? pnpm && lib.versionAtLeast pkgs.pnpm.version requiredPnpmCompatVersion then
            pkgs.pnpm
          else
            throw "Nixpkgs pnpm is too old for this repo. Required >= ${requiredPnpmCompatVersion} (matching packageManager ${requiredPnpmVersion} major/minor), but found pnpm=${if pkgs ? pnpm then pkgs.pnpm.version else "missing"} ${requiredPnpmAttr}=${if builtins.hasAttr requiredPnpmAttr pkgs then (builtins.getAttr requiredPnpmAttr pkgs).version else "missing"}.";
        pnpm =
          if pnpmBase ? override then
            pnpmBase.override { inherit nodejs; }
          else
            pnpmBase;

        # Electron version must match package.json
        electronVersion = "30.5.1";

        # Pre-fetch Electron binary for Linux x64
        # electron-builder expects zips named: electron-v${version}-linux-x64.zip
        electronLinuxZip = pkgs.fetchurl {
          url = "https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-linux-x64.zip";
          sha256 = "sha256-7EcHeD056GAF9CiZ4wrlnlDdXZx/KFMe1JTrQ/I2FAM=";
        };

        # Create a directory with the electron zip for electronDist
        electronDistDir = pkgs.runCommand "electron-dist" {} ''
          mkdir -p $out
          cp ${electronLinuxZip} $out/electron-v${electronVersion}-linux-x64.zip
        '';

        # Pre-fetch Electron headers for native module compilation (node-gyp)
        electronHeaders = pkgs.fetchurl {
          url = "https://www.electronjs.org/headers/v${electronVersion}/node-v${electronVersion}-headers.tar.gz";
          sha256 = "sha256-Q+c8G4nIRoJL/0uAYVYY2hrnFgvmkKB6RC3nxJtFYzU=";
        };

        # Create a node-gyp cache directory with the Electron headers
        electronHeadersDir = pkgs.runCommand "electron-headers" {} ''
          mkdir -p $out/${electronVersion}
          tar -xzf ${electronHeaders} -C $out/${electronVersion} --strip-components=1
          echo "9" > $out/${electronVersion}/installVersion
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
          ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
            pkgs.libiconv
          ]
          ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.libsecret
            pkgs.sqlite
            pkgs.zlib
            pkgs.libutempter
            pkgs.patchelf
          ];
        cleanSrc = lib.cleanSource ./.;
        emdashPackage =
          if pkgs.stdenv.hostPlatform.isLinux then
            pkgs.stdenv.mkDerivation rec {
              pname = "emdash";
              version = packageJson.version;
              src = cleanSrc;
              pnpmDeps =
                if pkgs ? fetchPnpmDeps then
                  pkgs.fetchPnpmDeps {
                    inherit pname version src;
                    inherit pnpm;
                    fetcherVersion = 1;
                    hash = "sha256-utuVjD/5w9AihDqvwFOzTqWvQqdHcKj3PybdOE2Cef8=";
                  }
                else
                  pnpm.fetchDeps {
                    inherit pname version src;
                    fetcherVersion = 1;
                    hash = "sha256-utuVjD/5w9AihDqvwFOzTqWvQqdHcKj3PybdOE2Cef8=";
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
                pkgs.libglvnd
                pkgs.mesa
                pkgs.alsa-lib
                pkgs.nss
                pkgs.nspr
                pkgs.systemdLibs
                pkgs.gtk3
                pkgs.at-spi2-atk
                pkgs.at-spi2-core
                pkgs.cups
                pkgs.libdrm
                pkgs.pango
                pkgs.cairo
                pkgs.libx11
                pkgs.libxcomposite
                pkgs.libxdamage
                pkgs.libxext
                pkgs.libxfixes
                pkgs.libxrandr
                pkgs.libxcb
                pkgs.libxkbcommon
                pkgs.expat
              ];
              env = {
                HOME = "$TMPDIR/emdash-home";
                npm_config_build_from_source = "true";
                npm_config_manage_package_manager_versions = "false";
                # Skip Electron binary download during pnpm install
                ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              };

              buildPhase = ''
                runHook preBuild

                mkdir -p "$TMPDIR/emdash-home"
                pnpm config set manage-package-manager-versions false

                # Build the app (renderer + main)
                pnpm run build

                # Rebuild native modules (keytar, sqlite3, node-pty) for Electron
                # Point node-gyp at pre-fetched headers to avoid network access
                export npm_config_nodedir="${electronHeadersDir}/${electronVersion}"
                pnpm exec electron-rebuild -f -v ${electronVersion} --only=sqlite3,node-pty,keytar

                # Run electron-builder with electronDist override to avoid download
                # Use --dir to only produce unpacked output (no AppImage/deb which require network)
                pnpm exec electron-builder --linux --dir \
                  -c.electronDist=${electronDistDir} \
                  -c.electronVersion=${electronVersion}

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
                makeWrapper $out/share/emdash/linux-unpacked/emdash $out/bin/emdash \
                  --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [
                    pkgs.libglvnd
                    pkgs.mesa
                    pkgs.alsa-lib
                    pkgs.nss
                    pkgs.nspr
                    pkgs.systemdLibs
                    pkgs.libsecret
                  ]}"

                runHook postInstall
              '';

              meta = {
                description = "Emdash – multi-agent orchestration desktop app";
                homepage = "https://emdash.sh";
                license = lib.licenses.mit;
                platforms = [ "x86_64-linux" ];
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
