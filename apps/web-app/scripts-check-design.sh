#!/usr/bin/env bash
# Fails when a screen still uses the old dark-theme / ad-hoc colour classes instead of the design system.
cd "$(dirname "$0")/src" || exit 2
PAT='(bg|text|border|ring|from|to|via|divide|placeholder)-(slate|indigo|emerald|rose|amber|sky|cyan|violet|purple|pink|teal|orange|zinc|gray|stone|fuchsia|lime|red|green|blue|yellow)-[0-9]{2,3}|bg-gradient|glass-panel|bg-\[#|text-white|text-black|bg-black|bg-white'
hits=$(grep -rnE "$PAT" --include=*.tsx --include=*.ts --include=*.css . | grep -v "components/ui/kit.tsx" | grep -vE "text-white.*(bg-brand|bg-danger|bg-success)|(bg-brand|bg-danger|bg-success)[^\"']*text-white" )
if [ -n "$hits" ]; then echo "$hits"; echo; echo "$(echo "$hits" | wc -l) legacy colour class use(s) remain"; exit 1; fi
echo "design check: no legacy colour classes"
