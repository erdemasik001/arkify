# Demo video script (≤ 3:00)

Target length **2:58**. The voice-over is about 310 words, which leaves room for the UI to breathe at
a normal speaking pace. Everything is shown on the live app, https://arkify-one.vercel.app, with the
verifier fleet running.

## What each part proves

| Time | Part | Rubric criterion it serves |
|---|---|---|
| 0:00–0:22 | The problem: one operator's badge | Why this pillar (who is harmed) |
| 0:22–0:55 | ENS registry: Verified, tampered copy: Mismatch | How you use Arkiv (`code_hash` scoping, attribute queries) |
| 0:55–1:32 | The dishonest verifier, then Disputed; leases | Security (`$creator` filter), Entity Expiration as a lease |
| 1:32–2:25 | A live request answered without a refresh | Atomic batch, WebSocket events, Lifetime Extension |
| 2:25–2:45 | `curl` straight to Arkiv | Censorship Resistance, Why Arkiv |
| 2:45–2:58 | Repo, schema, friction log | Reproducibility, friction report |

## Second by second

| Time | On screen | Voice-over |
|---|---|---|
| **0:00–0:12** | Home page hero, still. Slow scroll to the three feature cards. | "When an explorer says a contract's source is verified, you are trusting one operator's database. It can be wrong, hacked, or switched off." |
| **0:12–0:22** | Scroll back up. Cursor rests on the search box. | "Arkify replaces that badge with signed statements from independent verifiers, stored on Arkiv. And you decide whose word counts." |
| **0:22–0:32** | Click the **ENS registry** chip. The contract page loads: **Verified**, 3 of 3. | "This is the ENS registry on Sepolia. My browser read the deployed bytecode, hashed it, and asked Arkiv for attestations about exactly that code." |
| **0:32–0:45** | Hover **Code hash**. Scroll to the three `full_match` rows. Hover one signer address to show the explorer link. | "Three verifiers I trust compiled the source themselves and got a full match. Each row is signed. The address is the entity's creator, which Arkiv sets and nobody can change." |
| **0:45–0:55** | Scroll to the second source card: **Mismatch** ×3, "Runtime bytecode differs at byte 965". | "Someone also submitted a tampered copy, with `msg.sender` changed to `tx.origin`. All three said mismatch." |
| **0:55–1:08** | Scroll to **From accounts you do not trust**. Both `full_match` rows say "Demo-only dishonest verifier: nothing was compiled." | "This account claims everything matches. It never compiled anything. The trust filter runs on Arkiv's creator field, so its claims are shown and never counted." |
| **1:08–1:20** | Click **Trust** on it. Scroll to the top: **Disputed**, "1 of 4 matched, 3 objected". | "If I choose to trust it, the contract turns Disputed. Arkify shows who said what, instead of a green tick." |
| **1:20–1:32** | Click **Change who you trust**. The Verifiers page shows four cards: Online, last heartbeat, "lease ends in 14 min". Click **Reset to the defaults**. | "Each verifier holds a fifteen-minute lease on Arkiv, renewed with every heartbeat. If one dies, its registration simply expires." |
| **1:32–1:45** | Logo → home. Click the **A contract nobody has checked** chip (WETH on Sepolia). It shows **Unverified**. Click **Request a verification**. | "Now a contract nobody has checked yet: WETH on Sepolia." |
| **1:45–2:05** | The Request page opens with the address filled in. Click **Import from Sourcify**: `0.4.19+commit.c4cbbb05` and `WETH9.sol:WETH9` appear. Click **Connect wallet and submit** and confirm in the wallet *(cut the wallet popup down to ~2 s)*. | "I import the published source and sign one Arkiv transaction. It writes the source and the request together, so a request can never point at a missing source." |
| **2:05–2:25** | "Your request is on Arkiv" → **Watch the answers arrive**. The attestations appear one by one without a reload. *(Keep the first arrival in real time and trim any longer wait.)* The page settles on **Verified**, 3 of 3, with the dishonest verifier under untrusted. | "Verifiers hear the request over Arkiv's WebSocket events, recompile with the official compiler, and sign their answers. This page listens to the same stream, so they appear without a refresh." |
| **2:25–2:45** | Scroll to **Verify this without us**. Press **Copy** on "arkiv_query over JSON-RPC", paste it into a terminal and run it. The JSON shows each `creator` and `verdict`. | "This site is static files with no backend, and every page prints the exact query behind it. If our site and our verifiers disappeared tomorrow, anyone could still read these attestations from Arkiv." |
| **2:45–2:58** | GitHub README, then hover the `arkiv/schema.md` and `arkiv/friction.md` links. End card: **arkify-one.vercel.app** and the repo URL. | "Attestations live ninety days, and anyone who relies on one can extend them. Schema, queries and our friction log are in the repo. Arkify: verification without a gatekeeper." |

## Before recording

1. **Fleet online.** On the Verifiers page all four should show "Online". If they do not, run
   `ssh sorofy 'cd /opt/arkify && docker compose ps'`.
2. **Browser wallet** on Tiramisu with a little GLM. The source and request transaction costs well
   under 0.01 GLM. Its address appears on screen and becomes the `$creator` of the request, so use
   a wallet that is fine to show.
3. **Clean browser state.** Click "Reset to the defaults" on the Verifiers page. Use a 1440×900 or
   1920×1080 window at 110–125 % zoom, with no bookmarks bar or extra tabs. The system should be in
   dark mode.
4. **Terminal:** large font, empty screen, in the repo folder.
5. **Query budget.** Without an access key the public RPC allows about 100 `arkiv_query` calls per
   hour per IP address. A contract page costs about five, and rehearsals add up. Do no more than
   two or three full run-throughs an hour. If the app says it will answer again in N minutes, wait,
   or switch networks.
6. **The live request works once per contract.** After WETH has been verified it is no longer
   "unchecked". Rehearse the request part only up to the wallet prompt, then reject it there. If
   the real take fails, type one of these Sepolia backups into the search box instead of using the
   chip:
   - `0x3488a43B060E25a81b33a09E53773AB7eE9a77C0`: PaymentSplitterLite, solc 0.8.34
   - `0xD72ad515b0E7cBf99fbea880597A1210D7699293`: Storage, Remix's example contract, solc 0.8.34

   Both were dry-run with `pnpm verify` and gave `full_match`. Their sources contain no names or
   e-mail addresses, which matters because sources are stored on Arkiv byte for byte.

## After recording

- Export at 1080p. Upload it somewhere judges can open without signing in, such as YouTube
  (public or unlisted) or Loom, and check the link in a private window.
- Add the link to the README header and to the "Project links" in `SUBMISSION.md`.
- The home page chip "A contract nobody has checked" points at WETH, which is now verified. Point
  it at another unchecked contract.
- Add the browser wallet that signed the request to the wallet table in the README and in
  `SUBMISSION.md` (question 6).
