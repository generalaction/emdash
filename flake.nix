{
  description = "Emdash – multi-agent orchestration desktop app";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachSystem ["x86_64-linux" "aarch64-linux"] (system: let
      pkgs = import nixpkgs {inherit system;};
      inherit (pkgs) lib;

      # ---------- pnpm from package.json ----------
      packageJson = builtins.fromJSON (builtins.readFile ./package.json);
      pnpmPackageManager = packageJson.packageManager or "";
      pnpmVersionMatch = builtins.match "pnpm@([0-9]+\\.[0-9]+\\.[0-9]+)(\\+.*)?" pnpmPackageManager;
      requiredPnpmVersion =
        if pnpmVersionMatch != null
        then builtins.elemAt pnpmVersionMatch 0
        else throw "package.json must define packageManager as pnpm@<version>";
      requiredPnpmMajor = builtins.elemAt (builtins.match "([0-9]+)\\..*" requiredPnpmVersion) 0;
      requiredPnpmMinorLine = builtins.elemAt (builtins.match "([0-9]+\\.[0-9]+)\\..*" requiredPnpmVersion) 0;
      requiredPnpmAttr = "pnpm_${requiredPnpmMajor}";
      majorPnpm =
        if builtins.hasAttr requiredPnpmAttr pkgs
        then builtins.getAttr requiredPnpmAttr pkgs
        else null;
      # Nixpkgs can lag patch releases; require matching major.minor line.
      requiredPnpmCompatVersion = "${requiredPnpmMinorLine}.0";
      pnpmBase =
        if majorPnpm != null && lib.versionAtLeast majorPnpm.version requiredPnpmCompatVersion
        then majorPnpm
        else if pkgs ? pnpm && lib.versionAtLeast pkgs.pnpm.version requiredPnpmCompatVersion
        then pkgs.pnpm
        else
          throw ''
            Nixpkgs pnpm is too old.
            Required >= ${requiredPnpmCompatVersion} (from packageManager ${requiredPnpmVersion}).
            Found: pnpm=${lib.optionalString (pkgs ? pnpm) pkgs.pnpm.version}
                   ${requiredPnpmAttr}=${
              if majorPnpm != null
              then majorPnpm.version
              else "missing"
            }
          '';
      nodejs = pkgs.nodejs_22;
      pnpm = pnpmBase.override {inherit nodejs;};

      # ---------- Electron (pre-fetched for offline builds) ----------
      electronVersion = "40.7.0";
      electronArch =
        {
          x86_64-linux = "x64";
          aarch64-linux = "arm64";
        }
        .${system};

      electronLinuxZip = pkgs.fetchurl {
        url = "https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-linux-${electronArch}.zip";
        sha256 =
          {
            x86_64-linux = "sha256-D3utkbADhMTStZ6++QRBW+lb8G7b/llfD8tX9R/RR+Q=";
            aarch64-linux = "sha256-/dUAOLRDa5d1hdo94KTxGK79h/Ex7jQqZR1h6R6qFQs=";
          }
          .${system};
      };

      electronDistDir = pkgs.runCommand "electron-dist" {} ''
        mkdir -p $out
        cp ${electronLinuxZip} $out/electron-v${electronVersion}-linux-${electronArch}.zip
      '';

      electronHeaders = pkgs.fetchurl {
        url = "https://www.electronjs.org/headers/v${electronVersion}/node-v${electronVersion}-headers.tar.gz";
        sha256 = "sha256-M+UG5J/dCUxVE0lzNeMl4IP7nJs1WwvAtSyFfApbUR4=";
      };

      electronHeadersDir = pkgs.runCommand "electron-headers" {} ''
        mkdir -p $out
        tar xzf ${electronHeaders} -C $out --strip-components=1
      '';

      # ---------- shared dev dependencies ----------
      sharedEnv = [
        nodejs
        pkgs.git
        pkgs.python3
        pkgs.pkg-config
        pkgs.openssl
        pkgs.libtool
        pkgs.autoconf
        pkgs.automake
        pkgs.libsecret
        pkgs.sqlite
        pkgs.zlib
        pkgs.libutempter
        pkgs.patchelf
      ];

      # ---------- package ----------
      emdashPackage = pkgs.stdenv.mkDerivation rec {
            pname = "emdash";
            version = packageJson.version;
            src = lib.cleanSource ./.;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit pname version src pnpm;
              fetcherVersion = 1;
              hash = "sha256-CqS39LSztynmS12Gifdo1OmlttiYnBfXphwlscrED9Y=";
            };

            nativeBuildInputs =
              sharedEnv
              ++ [
                pnpm
                pkgs.pnpmConfigHook
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
              ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              EMDASH_SKIP_ELECTRON_REBUILD = "1";
              npm_config_nodedir = "${electronHeadersDir}";
            };

            buildPhase = ''
              runHook preBuild

              mkdir -p "$TMPDIR/emdash-home"

              # cpu-features is an optional dep of ssh2 whose native build requires
              # a git submodule that isn't populated in the npm tarball.
              rm -rf node_modules/cpu-features

              # Rebuild native modules against Electron headers
              pnpm exec electron-rebuild -f --only=better-sqlite3,node-pty

              pnpm run build

              pnpm exec electron-builder --linux --dir \
                --config electron-builder.config.ts \
                -c.electronDist=${electronDistDir}

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              local unpackedDir="$PWD/release/linux-unpacked"
              if [ ! -d "$unpackedDir" ]; then
                echo "Expected linux-unpacked at $unpackedDir" >&2
                exit 1
              fi

              install -d $out/share/emdash
              cp -R "$unpackedDir" $out/share/emdash/

              install -d $out/bin
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
              platforms = ["x86_64-linux" "aarch64-linux"];
            };
          };
    in {
      devShells.default = pkgs.mkShell {
        packages = sharedEnv;

        shellHook = ''
          echo "Emdash dev shell ready — Node $(node --version)"
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
