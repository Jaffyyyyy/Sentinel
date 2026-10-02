# UkayFind Brand Guide

A responsive, installable, single-user brand reference guide created by Jasper S. Campado. This version is intentionally focused on brand profiles, logo references, label clues, collaborations, rarity context, and offline reading.

## Run on your computer

From this folder, start a local web server:

```powershell
python -m http.server 8000
```

Open <http://localhost:8000>. Python 3 is the only requirement; there is no package installation or build step. The localhost address is only for the computer running the server; entering `127.0.0.1` on an iPhone points to the iPhone itself.

## Publish with GitHub Pages

This is a static website; the included GitHub Actions workflow publishes the files without a build step.

1. Create a GitHub repository and upload the app files to its root, including `.github/workflows/pages.yml` and `.nojekyll`. If the GitHub upload page hides dot-folders, create `.github/workflows/pages.yml` with **Add file → Create new file** and paste in that workflow from this project. Do **not** upload secrets, exported browser data, or personal information.
2. Push to the `main` or `master` branch. The **Publish UkayFind Brand Guide** workflow runs automatically; it can also be started from the repository's **Actions** tab.
3. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the build/deployment source if it is not selected already.
4. When the workflow succeeds, open the Pages URL shown in **Settings → Pages**. For a project site it is usually `https://YOUR-NAME.github.io/YOUR-REPOSITORY/`.
5. Open that HTTPS address in Safari on iPhone and use **Share → Add to Home Screen**.

GitHub Pages may make the website publicly readable. Assume every file you commit and every page you publish can be seen by other people; this guide contains no server-side private-data protection. If you need a website that only you can access, use a private HTTPS host with access controls instead. Internet refreshes update the guide saved in the current browser. New online brand searches and logo albums are not uploaded to GitHub or synchronized between devices; a shared list across browsers would require a server/database.

## Use on iPhone

To install this as a Home Screen web app:

1. Make the guide available at an HTTPS website. GitHub Pages is a convenient option using the steps above, but the published site may be public. Use a private HTTPS host with access controls if you do not want other people to read the site.
2. Open its HTTPS address in **Safari** on the iPhone.
3. Tap **Share** → **Add to Home Screen**. Enable **Open as Web App** if iOS offers that option, then tap **Add**.
4. Open the new Home Screen icon once while online so Safari can cache the app shell and built-in guide.

The app includes the same steps and local-server warning under **iPhone help**. Its current `http://127.0.0.1:18765/` preview address is a computer-local address, not an iPhone address. A same-Wi-Fi LAN address may let an iPhone view a local server, but service-worker installation/offline support requires HTTPS (or localhost on the device itself); use private HTTPS hosting for a reliable installed app.

## What is included

- 45 bundled brand profiles with histories, label/wash-tag clues, collaborations, rarity context, category filters, and search.
- Online Wikipedia summaries refresh daily and brand searches add close matches to this browser as unverified research leads; logo-source checks run every 30 days. Both can be refreshed manually.
- Logo albums populated from the Wikidata logo property and Wikimedia Commons file metadata. The guide checks sources automatically at most every 30 days; **Check logo sources** forces an immediate check. Commons file revisions appear in the album, and a changed linked file/content keeps the prior version when its versioned image is available.
- Bundled Simple Icons marks as offline fallbacks for some brands; versioned Wikimedia album images are clearly labeled when they are unavailable offline.
- A privacy switch for external brand lookups and a control to clear saved online summaries, discoveries, and logo-history records.
- A service-worker app shell for offline use.

## Logo sourcing and limits

Online logo images are **Wikidata/Wikimedia Commons candidates**, not a guarantee that a logo is current, official, or approved by the brand. Wikimedia records can be incomplete or edited; an updated source-file link does not prove the company changed its identity. Compare every image with the brand's official website and the linked source file. Check the image's licence and trademark terms before reuse or redistribution.

Album dates are repository/file dates, not verified logo adoption or retirement dates. The guide can show recent versions from a Commons file history; it cannot reconstruct marks never represented in that file. It begins retaining later source changes after it has observed a file. Saved image URLs need internet access; the existing bundled Simple Icons marks are available offline. External-service availability, browser caching, and local-storage limits can affect refreshes.

Simple Icons artwork is bundled as offline brand marks for a subset of profiles. Where no bundled mark or sourced image is available, the guide shows the brand name as text rather than inventing logo artwork.

## Privacy and accuracy

The app has no account, application server, user sync, marketplace, live valuation, computer-vision model, or community feature. Brand data and settings are saved to this browser's local storage; anyone with access to the same browser profile can access them. This app does not upload photographs.

When online lookup is enabled, brand names are sent to Wikipedia, Wikidata, and Wikimedia Commons. Search providers may receive those terms. Photos, profile information, and other activity are not sent. Disable online lookups under **Privacy** to keep guide browsing on-device. Built-in reference content remains available offline.

Online research leads, summaries, logo candidates, older label clues, and collaboration examples may be incomplete. Logo-source changes are not verified rebrands. Rarity is about an exact item and requires evidence and provenance; the guide does not authenticate goods or estimate value.

**Created by Jasper S. Campado.**
