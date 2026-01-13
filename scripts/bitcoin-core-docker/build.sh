#!/bin/bash
#
# Build Sanctuary's verified Bitcoin Core Docker image
#
# This script builds Bitcoin Core from official source with signature
# verification, creating a Docker image that can be used for address
# verification and testing.
#
# Usage:
#   ./build.sh                    # Build latest stable (27.0)
#   ./build.sh 26.2               # Build specific version
#   ./build.sh --list-versions    # Show available versions
#
# The built image will be tagged as: sanctuary-bitcoind:VERSION

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_VERSION="27.0"
IMAGE_PREFIX="sanctuary-bitcoind"

# Available Bitcoin Core versions (add new releases here)
AVAILABLE_VERSIONS=(
    "27.0"
    "26.2"
    "26.1"
    "26.0"
    "25.2"
    "25.1"
    "25.0"
    "24.2"
    "24.1"
    "24.0.1"
)

list_versions() {
    echo "Available Bitcoin Core versions:"
    for v in "${AVAILABLE_VERSIONS[@]}"; do
        if [ "$v" == "$DEFAULT_VERSION" ]; then
            echo "  $v (default)"
        else
            echo "  $v"
        fi
    done
}

check_version() {
    local version=$1
    for v in "${AVAILABLE_VERSIONS[@]}"; do
        if [ "$v" == "$version" ]; then
            return 0
        fi
    done
    return 1
}

build_image() {
    local version=$1
    local image_name="${IMAGE_PREFIX}:${version}"

    echo "=============================================="
    echo " Building Bitcoin Core v${version}"
    echo "=============================================="
    echo ""
    echo "This will:"
    echo "  1. Download Bitcoin Core source from bitcoincore.org"
    echo "  2. Verify release signatures against maintainer keys"
    echo "  3. Build from verified source"
    echo "  4. Create minimal Docker image"
    echo ""
    echo "Image will be tagged as: ${image_name}"
    echo ""

    # Check if image already exists
    if docker image inspect "${image_name}" &>/dev/null; then
        echo "Image ${image_name} already exists."
        read -p "Rebuild? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Skipping build."
            return 0
        fi
    fi

    # Build the image
    echo "Starting build..."
    docker build \
        --build-arg BITCOIN_VERSION="${version}" \
        --tag "${image_name}" \
        --tag "${IMAGE_PREFIX}:latest" \
        --file "${SCRIPT_DIR}/Dockerfile" \
        "${SCRIPT_DIR}"

    echo ""
    echo "=============================================="
    echo " Build Complete!"
    echo "=============================================="
    echo ""
    echo "Image: ${image_name}"
    echo ""
    echo "Test with:"
    echo "  docker run --rm ${image_name} --version"
    echo ""
    echo "Run regtest node:"
    echo "  docker run -d --name bitcoind-test \\"
    echo "    -p 18443:18443 \\"
    echo "    ${image_name} \\"
    echo "    -regtest -server -rpcuser=test -rpcpassword=test \\"
    echo "    -rpcallowip=0.0.0.0/0 -rpcbind=0.0.0.0"
}

# Parse arguments
case "${1:-}" in
    --list-versions|-l)
        list_versions
        exit 0
        ;;
    --help|-h)
        echo "Usage: $0 [VERSION]"
        echo ""
        echo "Build a verified Bitcoin Core Docker image from source."
        echo ""
        echo "Options:"
        echo "  --list-versions, -l   List available versions"
        echo "  --help, -h            Show this help"
        echo ""
        echo "Examples:"
        echo "  $0              Build default version (${DEFAULT_VERSION})"
        echo "  $0 26.2         Build version 26.2"
        exit 0
        ;;
    "")
        VERSION="$DEFAULT_VERSION"
        ;;
    *)
        VERSION="$1"
        if ! check_version "$VERSION"; then
            echo "Error: Unknown version '$VERSION'"
            echo ""
            list_versions
            exit 1
        fi
        ;;
esac

# Run the build
build_image "$VERSION"
