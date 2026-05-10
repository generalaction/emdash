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
        nodejs = pkgs.nodejs_24;
        electron = pkgs.electron_40;
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
            pkgs.stdenv.mkDerivation rec {
              pname = "emdash";
              version = packageJson.version;
              src = cleanSrc;
              # Fixed-output derivation that mirrors the pnpm offline store derived from
              # pnpm-lock.yaml. Whenever pnpm-lock.yaml changes, this hash needs to be
              # recomputed: set it to "" (or lib.fakeHash), run `nix build .`, and copy
              # the `got: sha256-…` value from Nix's error message back into this field.
              pnpmDeps = pkgs.fetchPnpmDeps {
                inherit pname version src pnpm;
                fetcherVersion = 3;
                hash = "sha256-hNsar5yOsMGh1DP+Y9sm2Up0wcwuYCpTHoFRnfJPjVw=";
              };
              nativeBuildInputs =
                sharedEnv
                ++ [
                  pnpm
                  pkgs.pnpmConfigHook
                  pkgs.dpkg
                  pkgs.rpm
                ];
              buildInputs = [
                pkgs.libsecret
                pkgs.sqlite
                pkgs.zlib
                pkgs.libutempter
              ];
              env = {
                HOME = "$TMPDIR/emdash-home";
                npm_config_build_from_source = "true";
                npm_config_manage_package_manager_versions = "false";
                # Skip Electron binary download during pnpm install
                ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
                npm_config_nodedir = "${electron.headers}";
              };

              # pnpmConfigHook runs `pnpm install --ignore-scripts`, so the project's
              # `postinstall` (which invokes electron-rebuild) is skipped. node-pty 1.1.0
              # ships no linux-x64 prebuild, so we must rebuild it ourselves before
              # electron-builder packages the app. Pin to nixpkgs' electron version so
              # the headers actually match the binary we ship.
              preBuild = ''
                pnpm exec electron-rebuild --force --version ${electron.version} --only=better-sqlite3,node-pty
              '';

              buildPhase = ''
                runHook preBuild

                mkdir -p "$TMPDIR/emdash-home"
                pnpm config set manage-package-manager-versions false

                # Build the app (renderer + main)
                pnpm run build

                # Run electron-builder with electronDist override to avoid download
                # Use --dir to only produce unpacked output (no AppImage/deb which require network)
                pnpm exec electron-builder --config electron-builder.config.ts --linux --dir \
                  -c.electronDist=${electron.dist} \
                  -c.electronVersion=${electron.version}

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
                cat <<EOF > $out/bin/emdash
#!${pkgs.bash}/bin/bash
set -euo pipefail

APP_ROOT="$out/share/emdash/linux-unpacked"
export LD_LIBRARY_PATH="${lib.makeLibraryPath [ pkgs.libglvnd ]}\''${LD_LIBRARY_PATH:+:}\''${LD_LIBRARY_PATH:-}"
exec "\$APP_ROOT/emdash" --no-sandbox "\$@"
EOF
                chmod +x $out/bin/emdash

                runHook postInstall
              '';

              meta = {
                description = "Emdash – multi-agent orchestration desktop app";
                homepage = "https://emdash.sh";
                license = lib.licenses.asl20;
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
