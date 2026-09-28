# Waste Notes

Waste transfer notes made from a count of what goes on the van. Built for removals and clearance crews on Android phones, and it works with no signal.

## How it works

1. **The office sets up the job.** It records who the waste belongs to (not just who pays), their SIC code, who will sign, which tip sites are used, and what waste is expected. Checks run before the job can go out. The crew lead gets a job link.
2. **The client signs once, before the first load.** Their named person signs the waste description on the phone, including the waste hierarchy declaration in England and Wales. The signature is sealed on the phone there and then.
3. **The crew counts each load** from a fixed item list, using big buttons in coloured sections:
   - general
   - upholstered seating (POPs): kept unmixed and unloaded separately
   - electricals
   - STOP: hazardous

   Hazardous items are logged and left, never loaded. Anything not on the signed description needs a signed addition.
4. **At the tip,** the gate slip shows what the site has to record. The ticket number and weight are kept for our own records.
5. **At the end,** the phone makes the waste transfer note as a PDF and seals it with a SHA-256 fingerprint. The client gets the PDF. The office gets the PDF and the sealed record for the register, which re-checks every seal.

Householders clearing their own home get a receipt instead of a transfer note. Scottish jobs follow the Scottish rules: no hierarchy declaration, and the client signs every load.

## Where the data lives

Everything stays on the device that made it, in the browser's storage for this app: jobs, counts, signatures, photos and sealed notes. The app asks the browser to protect that storage, and installing the app to the home screen helps. After a note is made, the app asks for the office copy (PDF plus sealed record) to be sent straight away, and it flags any note whose office copy has not gone. **Back up now** saves or sends one sealed file holding every job and record on the device. **Restore** adds anything missing, keeps the newer copy of a job, and never deletes anything.

## Privacy

- Job details travel inside the job link's `#` fragment, so the web server never sees them.
- Records stay on the phone until someone presses Send.
- The app has no server, no accounts and no tracking.
- Company details, the item list and tip sites load as settings. None of them are in this code.

## Settings

See `settings.example.json`, which uses a made-up company. The office loads its own settings file and sends each phone a setup link.

## Development

No build step. Serve the folder over HTTPS (or localhost) and open `index.html`.

    node test/core.test.mjs    # core tests; writes sample PDFs to test/out/

## Legal basis

- Electronic notes and signatures: Waste (England and Wales) Regulations 2011, reg 35(4)–(5).
- Series of loads under one note: Environmental Protection Act 1990, s34(4A)(b).
- Upholstered seating: Environment Agency POPs guidance (July 2026).

This app is a tool, not legal advice. The business using it is responsible for its own waste codes, item list and procedures.
