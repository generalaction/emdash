#!/usr/bin/env python3
"""Download official MCP catalog icons from simple-icons and brand sources."""

from __future__ import annotations

import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

ICON_DIR = Path(__file__).resolve().parents[1] / "src/assets/images/mcp"
SI_BASE = "https://cdn.jsdelivr.net/npm/simple-icons/icons"
ALOGO_BASE = "https://cdn.jsdelivr.net/gh/callback-io/allogo@main/public/logos"

# Catalog key -> simple-icons slug (keys omitted use custom OFFICIAL overrides).
SIMPLE_ICONS_SLUGS: dict[str, str] = {
    "playwright": "playwright",
    "supabase": "supabase",
    "vercel": "vercel",
    "sentry": "sentry",
    "stripe": "stripe",
    "figma": "figma",
    "linear": "linear",
    "slack": "slack",
    "cloudflare": "cloudflare",
    "netlify": "netlify",
    "chrome_devtools": "googlechrome",
    "atlassian": "atlassian",
    "asana": "asana",
    "aws_marketplace": "amazonaws",
    "azure": "microsoftazure",
    "bigquery": "googlebigquery",
    "canva": "canva",
    "clerk": "clerk",
    "clickup": "clickup",
    "cloudinary": "cloudinary",
    "graphite": "graphite",
    "graphos": "graphql",
    "hugging_face": "huggingface",
    "intercom": "intercom",
    "make": "make",
    "microsoft_learn": "microsoft",
    "miro": "miro",
    "mongodb": "mongodb",
    "motherduck": "duckdb",
    "neon": "neon",
    "notion": "notion",
    "planetscale": "planetscale",
    "posthog": "posthog",
    "prisma": "prisma",
    "railway": "railway",
    "resend": "resend",
    "sanity": "sanity",
    "shopify": "shopify",
    "wix": "wix",
    "wordpress": "wordpress",
    "webflow": "webflow",
}

DISPLAY_NAMES: dict[str, str] = {
    "chrome_devtools": "Chrome DevTools",
    "aws_marketplace": "AWS Marketplace",
    "microsoft_learn": "Microsoft Learn",
    "hugging_face": "Hugging Face",
    "magic_patterns": "Magic Patterns",
    "dev_manager": "Dev Manager",
    "motherduck": "MotherDuck",
    "mcp_default": "Model Context Protocol",
    "monday": "monday.com",
    "shopify": "Shopify Dev",
    "azure": "Azure MCP Server",
}


def fetch(url: str, timeout: int = 30) -> str:
    result = subprocess.run(
        ["curl", "-fsSL", "--max-time", str(timeout), url],
        capture_output=True,
        check=True,
    )
    return result.stdout.decode("utf-8")


def strip_mono_colors(svg: str) -> str:
    svg = re.sub(r"<style[^>]*>.*?</style>", "", svg, flags=re.DOTALL | re.IGNORECASE)
    svg = re.sub(r"<defs[^>]*>.*?</defs>", "", svg, flags=re.DOTALL | re.IGNORECASE)
    svg = re.sub(r"\sstyle=\"[^\"]*\"", "", svg)
    svg = re.sub(r"\sfill=\"[^\"]*\"", "", svg)
    svg = re.sub(r"\sstroke=\"[^\"]*\"", "", svg)
    svg = re.sub(r"\sfill-opacity=\"[^\"]*\"", "", svg)
    svg = re.sub(r"\sstroke-width=\"[^\"]*\"", "", svg)
    svg = re.sub(r"\sclass=\"[^\"]*\"", "", svg)
    return svg


def wrap_svg(title: str, view_box: str, inner: str) -> str:
    return (
        f'<svg role="img" viewBox="{view_box}" xmlns="http://www.w3.org/2000/svg">\n'
        f"<title>{title}</title>\n"
        f"{inner}\n"
        "</svg>\n"
    )


def install_simple_icon(key: str, slug: str) -> None:
    raw = fetch(f"{SI_BASE}/{slug}.svg")
    if "<svg" not in raw:
        raise ValueError(f"Invalid simple-icons response for {slug}")
  # simple-icons already includes role/title; normalize to single line inner format.
    title = DISPLAY_NAMES.get(key, re.search(r"<title>([^<]+)</title>", raw).group(1))
    path_match = re.search(r"<path[^>]+>", raw)
    if not path_match:
        raise ValueError(f"No path in simple-icons SVG for {slug}")
    path = path_match.group(0)
    content = wrap_svg(title, "0 0 24 24", path)
    (ICON_DIR / f"{key}.svg").write_text(content)


def install_official() -> None:
    # Amplitude — callback-io/allogo (official brand mark)
    amp = fetch(f"{ALOGO_BASE}/amplitude/icon.svg")
    amp_path = re.search(r"<path[^>]+>", amp).group(0)
    (ICON_DIR / "amplitude.svg").write_text(
        wrap_svg("Amplitude", "0 0 256 256", strip_mono_colors(amp_path))
    )

    # Honeycomb — callback-io/allogo honeycombio (official 4-hex mark)
    hc = fetch(f"{ALOGO_BASE}/honeycombio/icon.svg")
    paths = "\n".join(re.findall(r"<path[^>]*/>", hc))
    (ICON_DIR / "honeycomb.svg").write_text(
        wrap_svg("Honeycomb", "0 0 64 64", strip_mono_colors(paths))
    )

    # Context7 — context7.com official logo mark (icon portion only)
    ctx = fetch("https://context7.com/_next/static/media/context7-logo-light.99ff21c1.svg")
    ctx_paths = "\n".join(
        re.findall(
            r"<path d=\"M10\.5724[^\"]+\"[^>]*/>|<path d=\"M17\.4276[^\"]+\"[^>]*/>",
            ctx,
        )
    )
    (ICON_DIR / "context7.svg").write_text(
        wrap_svg("Context7", "0 0 28 28", strip_mono_colors(ctx_paths))
    )

    # Jam — jam.dev official strawberry logo (cropped mark, mono)
    jam = fetch("https://jam.dev/images/jam-logo.svg")
    jam_paths = "\n".join(re.findall(r"<path[^>]*/>", jam))
    (ICON_DIR / "jam.svg").write_text(
        wrap_svg("Jam", "44 26 100 54", strip_mono_colors(jam_paths))
    )

    # Parallel — parallel.ai official line mark from the product site
    parallel = fetch("https://parallel.ai/icon.svg?icon.db1045ae.svg")
    parallel_path = "\n".join(re.findall(r"<path[^>]*/>", parallel))
    (ICON_DIR / "parallel.svg").write_text(
        wrap_svg("Parallel", "0 0 271 270", strip_mono_colors(parallel_path))
    )

    # Exa — official brand kit from exa.ai/brand (Logomark SVG)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        archive = tmp_path / "exa-brand-assets.zip"
        archive.write_bytes(
            subprocess.run(
                ["curl", "-fsSL", "--max-time", "60", "https://exa.ai/assets/Exa%20Brand%20Assets.zip"],
                capture_output=True,
                check=True,
            ).stdout
        )
        with zipfile.ZipFile(archive) as zip_file:
            zip_file.extractall(tmp_path)
        exa_raw = (
            tmp_path
            / "Exa Brand Assets/Logo/SVGs/Logomark/Exa Logomark Blue.svg"
        ).read_text()
    exa_paths = strip_mono_colors("\n".join(re.findall(r"<path[^>]*/>", exa_raw)))
    (ICON_DIR / "exa.svg").write_text(
        wrap_svg("Exa", "0 0 151 182", exa_paths)
    )

    # MCP fallback — official docs mark, without the black app-icon container.
    mcp_body = """<path d="M23.5996 85.2532L86.2021 22.6507C94.8457 14.0071 108.86 14.0071 117.503 22.6507C126.147 31.2942 126.147 45.3083 117.503 53.9519L70.2254 101.23" stroke="currentColor" stroke-width="11.0667" stroke-linecap="round"/>
<path d="M70.8789 100.578L117.504 53.952C126.148 45.3083 140.163 45.3083 148.806 53.952L149.132 54.278C157.776 62.9216 157.776 76.9357 149.132 85.5792L92.5139 142.198C89.6327 145.079 89.6327 149.75 92.5139 152.631L104.14 164.257" stroke="currentColor" stroke-width="11.0667" stroke-linecap="round"/>
<path d="M101.853 38.3013L55.553 84.6011C46.9094 93.2447 46.9094 107.258 55.553 115.902C64.1966 124.546 78.2106 124.546 86.8543 115.902L133.154 69.6025" stroke="currentColor" stroke-width="11.0667" stroke-linecap="round"/>"""
    (ICON_DIR / "mcp_default.svg").write_text(
        (
            '<svg role="img" viewBox="0 0 180 180" fill="none" '
            'xmlns="http://www.w3.org/2000/svg">\n'
            "<title>Model Context Protocol</title>\n"
            f"{mcp_body}\n"
            "</svg>\n"
        )
    )

    # Magic Patterns — official wordmark SVG (icon path only)
    mp = fetch("https://www.magicpatterns.com/magicpatterns_logo_light.svg")
    icon_path = re.search(
        r"<path d=\"M190\.138 68\.3793[^\"]+\"[^>]*/>", mp
    ).group(0)
    (ICON_DIR / "magic_patterns.svg").write_text(
        wrap_svg("Magic Patterns", "0 0 193 141", strip_mono_colors(icon_path))
    )

    # Dev Manager — generic monochrome server-manager mark; no raster/color fallback.
    (ICON_DIR / "dev_manager.svg").write_text(
        wrap_svg(
            "Dev Manager",
            "0 0 24 24",
            '<path d="M4 5.5C4 4.11929 5.11929 3 6.5 3H17.5C18.8807 3 20 4.11929 20 5.5V18.5C20 19.8807 18.8807 21 17.5 21H6.5C5.11929 21 4 19.8807 4 18.5V5.5ZM7 8H17V6H7V8ZM7 12.5H17V10.5H7V12.5ZM7 17H13V15H7V17Z"/>',
        )
    )


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    for key, slug in SIMPLE_ICONS_SLUGS.items():
        print(f"simple-icons: {key} ({slug})")
        install_simple_icon(key, slug)

    print("official overrides")
    install_official()

    print(f"Done. Icons in {ICON_DIR}")


if __name__ == "__main__":
    main()
