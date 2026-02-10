# Live Subtitle App 🎙️

A cross-platform desktop application built with **Electron**, **Vue 3**, and **TypeScript** for real-time subtitling and window projection.

Key Features:
- **Multi-Window Projection:** Create separate subtitle windows for OBS/Streaming.
- **Customizable Styles:** Adjust fonts, colors, chroma key backgrounds, and layout.
- **AWS Transcribe Integration:** High-accuracy real-time speech-to-text.
- **Display Management:** Send projection windows to specific monitors in fullscreen.
- **Persistence:** Save and restore window configurations instantly.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18+ recommended
- **pnpm**: Package manager (Install: `npm install -g pnpm`)

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd live-subtitle-app
pnpm install
```

### 2. Development Mode

Run the app locally with hot-reload (Vue & Electron):

```bash
pnpm run dev
```

This will launch the main Dashboard window.

### 3. Build for Production

To create a distributable application (dmg/exe/deb):

```bash
pnpm run build
```

The output files will be in the `release/` directory.

---

## ⚙️ Configuration

### AWS Credentials (Optional but Recommended)
For high-quality transcription, you need an AWS account with access to **Amazon Transcribe Streaming**.

1. Go to AWS Console -> IAM.
2. Create a user with `AmazonTranscribeFullAccess` (or specific streaming permissions).
3. Get the **Access Key ID** and **Secret Access Key**.
4. In the App Dashboard, click **Settings**, select **AWS**, and enter your credentials.

### Mock Mode (Default)
If no credentials are provided, the app runs in **Mock Mode**, generating random lorem ipsum text for testing UI and layout.

---

## 🛠️ Tech Stack

- **Electron**: Desktop runtime
- **Vue 3**: Frontend framework
- **Vite**: Build tool and dev server
- **TypeScript**: Type safety
- **TailwindCSS**: Styling
- **Pinia**: State management (ready for use)
- **AWS SDK v3**: Transcription service
