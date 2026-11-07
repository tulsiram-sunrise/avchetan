# Privacy

Avchetan is made to keep your entries yours. This page says what leaves your devices, and where it goes.

## What Avchetan never does

- It has **no analytics, no tracking and no crash reporting.** Nobody, including the people who make Avchetan, learns that you use it or what you write.
- It has **no account** with us. There is no Avchetan company server: the only servers are ones you run or choose.
- It doesn't show ads or sell data.

## What leaves your device, and only if you set it up

| What | Where it goes | When |
|---|---|---|
| Your entries, to be organized (with the app and window title they were typed over on the PC, see [Window context](capture-on-windows.md#window-context-and-rules), and the first 1 KB of any text you [attached from the clipboard](capture-on-windows.md#attach-the-clipboard), except for `!private` entries), your questions in **Ask**, and a day's entries for its [daily brief](daily-brief.md) | The AI model you chose in **AI models**: Ollama on your own PC, or a cloud provider such as Google Gemini or Groq | Only after you choose a model. With Ollama, nothing leaves your home network. With a cloud provider, that provider's privacy policy applies, and the setting says so when you choose it. |
| Everything you have in Avchetan | Your hub or server, to sync your devices | Only after you pair a device. A Home Hub is your own PC. A cloud server is one you set up. |
| Model downloads | ollama.com, through Ollama | When you click **Download them** in the hub checklist. |
| Opening this guide or a bug report | Your browser, to GitHub | When you click **Help**, **User guide** or **Report a problem**. |

API keys and sync tokens are stored in Windows' Credential Manager or Android's secure storage, never in plain files. Avchetan's own logs record counts and durations, never what you wrote.

## Your data on your devices

Your entries are stored on each device you use, and on your hub or server if you sync. You can [export everything or back it up](backup-and-restore.md) at any time, and [uninstalling](install-and-update.md#uninstall) explains how to remove it.

## Questions

Avchetan is open source, so anyone can check these statements in the [source code](https://github.com/tulsiram-sunrise/avchetan). How the app protects data is described for developers in [security and privacy](../conventions/security-and-privacy.md).
