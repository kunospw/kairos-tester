<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI work

Follow `docs/design.md` (ink text and buttons, cobalt only for links and focus, status = shape + colour + word, no gradients/shadows/emoji) and build from the primitives in `src/components/ui.tsx` and `src/components/icons.tsx` before adding new ones. Text must keep 4.5:1 contrast (`text-slate-500` is the lightest allowed body text; `slate-400` is for borders and decoration only), links inside running text are underlined, and click targets are at least 24 px. After UI changes run `A11Y_USER=... A11Y_PASSWORD=... npm run a11y` against a dev server.
