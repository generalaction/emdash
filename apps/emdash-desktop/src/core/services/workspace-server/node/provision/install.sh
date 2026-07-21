set -eu

mkdir -p -- "$root"
attempt=0
while ! mkdir "$lock" 2>/dev/null; do
  if [ -r "$lock_pid_file" ]; then
    lock_pid=$(cat "$lock_pid_file" 2>/dev/null || true)
  else
    lock_pid=
  fi
  if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
    rm -rf -- "$lock"
    continue
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 120 ]; then
    echo "timed out waiting for install lock" >&2
    exit 42
  fi
  sleep 0.25
done

printf '%s\n' "$$" > "$lock_pid_file"
cleanup() {
  rm -rf -- "$staging" "$archive" "$next_link"
  rm -rf -- "$lock"
}
trap cleanup EXIT HUP INT TERM

mkdir -p -- "$versions_dir" "$run_dir"
rm -f -- "$next_link"
if [ -d "$version_dir" ]; then
  if [ ! -x "$launcher" ]; then
    echo "existing workspace-server $version installation is incomplete" >&2
    exit 42
  fi
  ln -s -- "$version_dir" "$next_link"
  mv -Tf -- "$next_link" "$current_link"
  exit 0
fi

rm -rf -- "$staging" "$archive"
mkdir -p -- "$staging"
if command -v curl >/dev/null 2>&1; then
  curl -fL --output "$archive" -- "$url"
elif [ "${url#http://}" != "$url" ] || [ "${url#https://}" != "$url" ]; then
  if command -v wget >/dev/null 2>&1; then
    wget -O "$archive" -- "$url"
  else
    echo "curl or wget is required to install this workspace-server artifact" >&2
    exit 41
  fi
else
  echo "curl is required to install this workspace-server artifact" >&2
  exit 41
fi

printf '%s  %s\n' "$sha256" "$archive" | sha256sum -c - >/dev/null || exit 42
tar --extract --gzip --file "$archive" --strip-components=1 --directory "$staging" --warning=no-unknown-keyword || exit 42
if [ ! -x "$staging_launcher" ]; then
  echo "artifact launcher is missing" >&2
  exit 42
fi

mv -- "$staging" "$version_dir"
ln -s -- "$version_dir" "$next_link"
mv -Tf -- "$next_link" "$current_link"
