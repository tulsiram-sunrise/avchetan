# Voice

Say an entry instead of typing it. Your voice is turned into text **on the device you're holding**: on the PC by a Whisper model that runs inside Avchetan, on the phone by Android's own on-device speech recognition. Nothing is sent to a server, and nothing needs the internet once it's set up. The recording is deleted as soon as it is text.

The text always lands in the capture box first, so you can check and fix it before saving. English and Hindi both work, mixed as you speak. Hindi comes out in Devanagari, English words in English:

```
आज gym में 40 minute running की, knee ठीक थी
```

The AI then organizes it like any typed entry.

## On the PC

### Set it up once

1. Open Avchetan from the tray and go to **Settings → Voice**.
2. Under **Speech model**, press **Download** next to one of the models:
   - **Fast; good for English, weak for Hindi** (about 150 MB). A second or two per note.
   - **Better for Hindi and Hinglish; a few seconds slower** (about 190 MB). Choose this one if you speak Hindi at all.

   The download is checked against its checksum before Avchetan uses it.
3. Under **Microphone**, keep **Windows default**, or pick the one you talk into. Press **Test** and say something: the bar should move.

### Talk

- **Hold your shortcut** (`Ctrl+Shift+Space` unless you changed it). The capture box opens and shows *Listening…*. Talk, then let go. A short press still opens and closes the capture box as before.
- **Or press 🎤** at the top right of the capture box. Press it again, or **Stop**, when you're done. This suits longer thoughts. Recording stops by itself after 5 minutes.
- **Esc** while listening throws the recording away.

*Writing it down…* shows for a moment. Then the text appears where the cursor was, so you can also add spoken words to something half-typed. Check it, then press your save key as usual.

### Language

**Settings → Voice → Language** is **English or Hindi, detected** by default: each recording is checked for which of the two it is, never any other language. If you mostly speak Hindi or Hinglish, choose **Hindi**: it skips the check, so it's quicker. Hindi is written in Devanagari, and English words in it stay in English letters as far as the model manages; the small model gets less of it right.

To free the space, press **Delete** next to a model. Voice then asks you to download one again.

## On the phone

Avchetan uses your phone's own speech recognition, **on the device only**. It never falls back to Google's online recognition, so the language must be downloaded on the phone:

1. In Avchetan, open **More → Voice** and choose a language:
   - **Hindi + English (switches as you speak)**, the default: starts in English and switches to Hindi when it hears Hindi, so English comes out in English letters and Hindi in Devanagari. It needs Android 14 and both languages on the phone; some phones ignore the switch and stay in English.
   - **English (India)**: everything in English letters. Accurate for English.
   - **Hindi**: everything in Devanagari, English words too (that's how Android's Hindi recognition writes them).
   - **Phone language**.
2. The screen says whether each language it needs is ready offline. If one isn't, tap its **Download**, or open Android **Settings**, search for **On-device speech recognition** (or **Offline speech recognition**), and download it there.

Then:

- **In the app:** tap 🎤 in the capture box and talk. The words appear as the phone hears them. Tap 🎤 again (or just stop talking) when you're done, then tap **Save**.
- **From the widget:** tap its 🎤. The capture screen opens already listening. **Save** sends the app back to the background.

The first time, Android asks to allow the microphone. Choose **While using the app**.

## What is kept

- **No recording is kept.** On the PC the audio stays in memory and is dropped once it is text; on the phone Avchetan never gets the audio at all, only the words.
- Entries you dictated are marked as voice entries (for your own statistics); the text is your entry like any other.
- Private tags and `!private` work the same way for spoken entries: see [Privacy](privacy.md).

## If it doesn't work

- [mic_unavailable](troubleshooting.md#mic_unavailable): no microphone found.
- [mic_permission_denied](troubleshooting.md#mic_permission_denied): Windows or Android blocked the microphone.
- [speech_model_missing](troubleshooting.md#speech_model_missing): no speech model downloaded on the PC.
- [speech_offline_unavailable](troubleshooting.md#speech_offline_unavailable): the phone can't recognise that language offline.
- [transcription_failed](troubleshooting.md#transcription_failed): the recording couldn't be turned into text.
