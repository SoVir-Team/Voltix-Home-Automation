# Design system

The web app follows the Muse home-automation screenshots, recoloured to the Voltix brand: the cyan bolt on
white with navy text. It is mobile-first and works from 320 px phones up to desktop. It installs as a PWA on
iOS and Android.

## Tokens

All colours, radii, shadows and motion live in [`frontend/src/styles/globals.css`](../frontend/src/styles/globals.css)
as Tailwind v4 `@theme` tokens. Components use token classes (`bg-brand-500`, `text-ink`, `shadow-card`) and
never raw hex. Restyling therefore means editing tokens, not screens.

| Token group | Values                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Brand       | `brand-50 … brand-700`; primary `brand-500` #1BA8E0 (the bolt), gradient `bg-brand-gradient`                                 |
| Text        | `ink` #0F1B33, `ink-soft`, `muted`, `subtle`                                                                                 |
| Surfaces    | `canvas` #F5F8FD (page), `surface` #FFFFFF (cards), `tint` (inputs, chips), `line` (borders)                                 |
| Status      | `success`, `warning`, `danger`                                                                                               |
| Shape       | `rounded-card` 1.75 rem, `rounded-tile` 1.25 rem, pills for buttons and chips                                                |
| Depth       | `shadow-card` (soft cyan-tinted), `shadow-float` (active tiles, primary buttons), `shadow-nav`                               |
| Motion      | `animate-pop` (springy entrance), `animate-sweep` (radar), `animate-pulse-ring`; all disabled under `prefers-reduced-motion` |
| Type        | Noto Sans; sizes from Tailwind's scale, bold for titles, semibold for labels                                                 |

## Layout

- **Phone:** bottom tab bar (Home, Device, Room, Profile), as in the Muse screens, with the other sections
  (scenes, automations, energy, activity, user access, boards…) one tap away. Cards are full width. Sheets slide up from the
  bottom. Safe-area insets are respected (`pb-safe`).
- **Tablet and desktop:** a left sidebar replaces the tab bar. Content sits in a centred column; grids grow from
  2 to 4 columns. Sheets become centred dialogs.
- **Touch targets** are at least 40 px. **Contrast** meets WCAG AA for text on `canvas` and `surface`.

## Components (`frontend/src/components`)

| Component               | Use                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ui/button`, `ui/field` | Buttons (primary gradient, soft, danger) and labelled inputs with error text                                  |
| `ui/card`               | Surface cards; tile variant for devices                                                                       |
| `ui/sheet`              | Modal on `<dialog>`: bottom sheet on phones, dialog on larger screens; `ConfirmSheet` for destructive actions |
| `ui/toggle`, `ui/chips` | Switches and filter chips                                                                                     |
| `ui/copy`               | Read-only value with copy button (keys, server address)                                                       |
| `ui/icon-picker`        | Room and scene icons                                                                                          |
| `devices/*`             | Device tile, detail controls (on/off, level slider, colour, thermostat…), radar used in the Add-device wizard |
| `automation/*`          | Trigger/condition/action step editor                                                                          |
| `charts`                | Bar and line charts for energy and sensor history                                                             |

Device controls come from each device's **capabilities**, not its type. Any built-in or custom template
therefore renders without new UI code.

## Copy

- Plain words a homeowner uses: "Board", "Turn on", "Offline for 5 min". Never "controller" or "payload" in
  the UI.
- Errors say what happened and what to do ("Hall Light is offline — check its power and Wi-Fi").
- Counts are pluralised properly ("1 device", "3 devices").
