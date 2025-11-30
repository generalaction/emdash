{
  description = "Nix dev shell for the Emdash Electron workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = pkgs.lib;
        nodejs = pkgs.nodejs_22;

        # Electron version must match package.json
        electronVersion = "30.5.1";

        # Pre-fetch Electron binary for Linux x64
        electronLinuxZip = pkgs.fetchurl {
          url = "https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-linux-x64.zip";
          sha256 = "sha256-7EcHeD056GAF9CiZ4wrlnlDdXZx/KFMe1JTrQ/I2FAM=";
        };

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
          if pkgs.stdenv.isLinux then
            pkgs.buildNpmPackage rec {
              pname = "emdash";
              version = "0.3.30";
              src = cleanSrc;
              inherit nodejs;
              npmDepsHash = "sha256-mNXxTDOoyiWDVieuqRGSPx3AS+9O2Q9e1MY8ip7B8UI=";
              npmBuildScript = "package:linux";
              nativeBuildInputs =
                sharedEnv
                ++ [
                  pkgs.dpkg
                  pkgs.rpm
                  pkgs.unzip
                ];
              buildInputs = [
                pkgs.libsecret
                pkgs.sqlite
                pkgs.zlib
                pkgs.libutempter
              ];
              env = {
                HOME = "$TMPDIR/emdash-home";
                XDG_CACHE_HOME = "$TMPDIR/emdash-home/.cache";
                ELECTRON_BUILDER_CACHE = "$TMPDIR/emdash-home/.cache/electron-builder";
                npm_config_build_from_source = "true";
                npm_config_cache = "$TMPDIR/emdash-home/.npm";
                # Skip Electron binary download during npm install
                ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              };
              preBuild = ''
                mkdir -p "$TMPDIR/emdash-home/.cache" "$TMPDIR/emdash-home/.npm"

                # Populate electron-builder cache with pre-fetched Electron
                # electron-builder looks for: ~/.cache/electron/vX.X.X/electron-vX.X.X-linux-x64.zip
                electronCacheDir="$TMPDIR/emdash-home/.cache/electron/v${electronVersion}"
                mkdir -p "$electronCacheDir"
                cp ${electronLinuxZip} "$electronCacheDir/electron-v${electronVersion}-linux-x64.zip"

                echo "Electron cache populated at: $electronCacheDir"
                ls -la "$electronCacheDir"
              '';

              installPhase = ''
                runHook preInstall

                distDir="$PWD/dist"
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
                cat <<EOF > $out/bin/emdash
#!${pkgs.bash}/bin/bash
set -euo pipefail

APP_ROOT="$out/share/emdash/linux-unpacked"
exec "\$APP_ROOT/emdash" "\$@"
EOF
                chmod +x $out/bin/emdash

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
            echo "Run 'npm run d' for the full dev loop."
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
