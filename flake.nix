{
  description = "Nix dev shell for the Emdash Electron workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nodejs = pkgs.nodejs_22;
        nativeBuildPackages =
          [
            pkgs.python3
            pkgs.pkg-config
            pkgs.openssl
            pkgs.libtool
            pkgs.autoconf
            pkgs.automake
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            pkgs.libiconv
          ];
      in {
        devShells.default = pkgs.mkShell {
          packages =
            [
              nodejs
              pkgs.git
            ]
            ++ nativeBuildPackages;

          shellHook = ''
            echo "Emdash dev shell ready"
            echo "Node: $(node --version)"
            echo "Run 'npm run d' for the full dev loop."
          '';
        };
      });
}
