# Libera

> A local-first media manager and player for everything you own — music, films, books, papers and beyond.

![License](https://img.shields.io/badge/license-Proprietary-red)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS-blue)
![Status](https://img.shields.io/badge/status-In%20Development-yellow)

---

## What is Libera?

Libera is an application that lets you manage and play all your local media from one place — music, films, series, books, scientific papers, and more. No subscriptions, no cloud dependency, no tracking. Your files, your way.

---

## Features (V1)

- 🎵 Music library with metadata support (MP3, FLAC)
- 🎬 Film and series manager
- 📚 Book and document library
- ⚡ Fast file scanning powered by Rust
- 🗄️ Local SQLite database — fully offline
- 🖥️ Native desktop app for Windows, macOS and Linux

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS |
| Animations | Framer Motion |
| State | Zustand + TanStack Query |
| Desktop | Tauri 2 |
| Backend | Rust |
| Database | SQLite |
| Audio | HTML5 Audio API |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Rust](https://rustup.rs)
- [pnpm](https://pnpm.io)

### Installation
```bash
git clone https://github.com/DerrickMC7/libera.git
cd libera
pnpm install
pnpm tauri dev
```

---

## Roadmap

### V1
- [x] Project setup
- [ ] Music library and player
- [ ] Film and series manager
- [ ] Book library
- [ ] Onboarding flow

### Future
- [ ] NAS support
- [ ] Cloud integration
- [ ] Android and iOS support
- [ ] Plugin system

---

## License

Copyright (c) 2026 Derrick Christopher Hernández Rojas. All rights reserved.
See [LICENSE](./LICENSE) for details.