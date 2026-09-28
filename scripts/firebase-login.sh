#!/bin/bash
set -e
export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/bin:$PATH"

echo "Using: $(which firebase) / node $(node -v)"

# Fix config permissions if needed (no sudo if already owned)
if [ -d "$HOME/.config" ]; then
  chown -R "$(id -un):$(id -gn)" "$HOME/.config" 2>/dev/null || true
  chmod -R u+rwX "$HOME/.config" 2>/dev/null || true
fi

# Login outside the project so .firebaserc does not force project auth first
cd /tmp
echo ""
echo "A browser window will open — sign in and Allow."
echo "If no browser: follow the printed URL / paste the code back here."
echo ""
firebase login --reauth

echo ""
echo "Logged-in accounts:"
firebase login:list

echo ""
echo "Next: cd ~/Dev/bba-quiz && firebase deploy --only hosting --config firebase.spark.json"
