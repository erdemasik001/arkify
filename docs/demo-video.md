# Demo video

**https://youtu.be/0M27XDnEVQs** · 2:31 · 1080p · silent, with English captions

Everything in it happens on the live app, https://arkify-one.vercel.app, against Tiramisu and
Sepolia, with the verifier fleet running. Nothing is mocked: the verdicts, the live request and
the terminal output are real.

## What it shows

| Time | On screen | Caption | Rubric criterion |
|---|---|---|---|
| 0:00–0:22 | Home page, then the live counters ("verifiers with a live lease"). | "When an explorer marks a contract's source as “verified”, you are trusting one operator's database." · "That database can be wrong, hacked, or switched off. Users sign transactions against it anyway." · "Arkify replaces the badge with signed statements from independent verifiers, stored on Arkiv. You decide whose word counts." | Why this pillar |
| 0:22–0:47 | ENS registry on Sepolia: **Verified**, 3 of 3. The code hash, the three `full_match` rows with signer addresses, then the tampered copy: **Mismatch** ×3. | "The ENS registry on Sepolia. The browser hashes the deployed bytecode and asks Arkiv for attestations about exactly that code." · "Three verifiers I trust each compiled the source and got a full match. Each row is signed: Arkiv sets the creator address and nobody can change it." · "A tampered copy was checked too (msg.sender changed to tx.origin). All three verifiers: mismatch." | How you use Arkiv (`code_hash`, attribute queries, `$creator`) |
| 0:47–1:16 | The untrusted section with the demo-only dishonest verifier. **Trust** → **Disputed** (1 of 4 matched, 3 objected). The Verifiers page with four online leases, then **Reset to the defaults**. | "This account claims everything matches. It never compiled anything. It is not in my trusted list, so it is shown and never counted." · "If I choose to trust it, the contract turns Disputed. Arkify shows who said what, instead of a green tick." · "Each verifier holds a 15-minute lease on Arkiv, renewed by every heartbeat. If one dies, its registration simply expires." | Security, Entity Expiration as a lease |
| 1:16–1:40 | A Sepolia address is typed into the search box: PaymentSplitterLite, **Unverified**. **Request a verification** → **Import from Sourcify** → the **Connect wallet and submit** button. | "Now a contract nobody has checked yet: a payment splitter on Sepolia." · "The source is imported from Sourcify. Where it comes from proves nothing: every verifier compiles it itself." · "Submitting is one Arkiv transaction: the source and the request are written together, in one atomic batch." | Atomic batch |
| 1:40–2:09 | Back on the contract page, a terminal runs `pnpm request 11155111 0x3488…77C0`. The dishonest verifier's claim lands first, under untrusted. Then, with no reload, the page turns **Verified**, 3 of 3 (about 19 s after the request). | "This recording has no browser wallet, so the same request is sent from the CLI, which calls the same submitRequest code." · "Verifiers hear the request over Arkiv's WebSocket events, recompile it with the official compiler and sign the result. This page listens to the same stream: no refresh." · "Verified: three trusted verifiers, full match. The dishonest one is listed apart and not counted." | WebSocket events, `$creator` |
| 2:09–2:24 | "Verify this without us" with the exact query and `curl`. Then `pnpm arkify check 11155111 0x3488…77C0` prints VERIFIED (full match). | "This site is static files with no backend. Every page prints the exact Arkiv query that produced it." · "Anyone can ask Arkiv directly, here with the CLI. If our site and our verifiers disappeared, these answers would still be readable." | Censorship Resistance, Why Arkiv |
| 2:24–2:31 | End card: live app, repo, schema and friction log. | — | Reproducibility |

## How it was recorded

- An automated Chrome (Playwright) drove the live site. The captions and the cursor are drawn on
  top of the page while recording, without changing it.
- The recording browser has no wallet, so the request was sent with `pnpm request`, which signs with
  the requester wallet from `.env`. It calls the same `submitRequest` as the Request page. Its real
  output is shown in the terminal panel.
- The browser's Arkiv queries went through the team's access key instead of the anonymous budget
  ([F-013](../arkiv/friction.md)), because rehearsals had used most of that budget. The app sent the
  same queries either way.

An earlier take, with WETH on Sepolia, showed one verifier attesting `error`. Three verifiers had
downloaded the same solc build into their shared cache at once and collided on one temporary file.
That was fixed in `a18dc9e` before the final take, which downloaded a new build the same way
without errors.

## For judges who want to try the live request themselves

The home page chip **A contract nobody has checked** opens Remix's Storage example on Sepolia
(`0xD72ad515b0E7cBf99fbea880597A1210D7699293`). It has no attestations yet, and its source verifies
with `full_match`. Requesting it from the app needs a browser wallet with a little testnet GLM from
the [Hub faucet](https://hub.arkiv.network/faucet).
