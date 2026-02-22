
## Table of Contents

- [Stellar Game Studio](#stellar-game-studio)
- [AlphaDuel](#alphaduel)
- [Video Demo](#video-demo)
- [Game Concept](#game-concept)
- [Why Zero-Knowledge Is Essential](#why-zero-knowledge-is-essential)
- [Smart Contract Architecture](#smart-contract-architecture)
- [Noir Zero-Knowledge Circuit](#noir-zero-knowledge-circuit)
- [Browser-Side Proof Generation (UltraHonk)](#browser-side-proof-generation-ultrahonk)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Ecosystem Constraints](#ecosystem-constraints)
- [MIT License](#mit-license)

# Stellar Game Studio

Development Tools For Web3 Game Builders On Stellar.\
Ecosystem ready game templates and examples ready to scaffold into your
development workflow

**Start here:** https://jamesbachini.github.io/Stellar-Game-Studio/

------------------------------------------------------------------------

# AlphaDuel
### Zero-Knowledge Multiplayer Word Strategy Game

AlphaDuel is a privacy-preserving, two-player competitive word strategy
game built on Soroban (Stellar smart contracts) and powered by
Zero-Knowledge Proofs (Noir + UltraHonk).

It combines:

-   Private game logic
-   On-chain cryptographic verification
-   Deterministic winner resolution
-   Trustless multiplayer gameplay
-   Stake-based competition (winner takes all)

AlphaDuel replaces centralized referees with mathematics.

------------------------------------------------------------------------

## Video DEMO

[![AlphaDuel ZK Multiplayer Word Game Explained](https://img.youtube.com/vi/tsdbotowpKA/0.jpg)](https://youtu.be/tsdbotowpKA)

------------------------------------------------------------------------

# Game Concept

Two players stake points and attempt to guess three letters that appear
in a hidden word.

The hidden word is derived deterministically from a predefined fruit
word list.

Each player:

1.  Selects 3 unique letters (A → 1 through Z → 26)
2.  Commits their guess via a cryptographic hash
3.  After both players commit, a Zero-Knowledge proof executes
4.  The proof determines which player matched more letters
5.  The winner receives all staked points

The hidden word is never revealed publicly.

------------------------------------------------------------------------

# Why Zero-Knowledge Is Essential

Without Zero-Knowledge:

-   The hidden word would need to be revealed
-   A centralized server would referee
-   Players could manipulate scoring
-   Privacy would be compromised

With Zero-Knowledge:

-   The hidden word remains private
-   The blockchain verifies correctness
-   No server is trusted
-   The result is mathematically enforced

ZK is the core mechanic of AlphaDuel --- not an optional feature.

------------------------------------------------------------------------

# Smart Contract Architecture

## Game Structure

``` rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player1_guess: Option<Vec<u32>>,
    pub player1_points: i128,

    pub player2: Address,
    pub player2_guess: Option<Vec<u32>>,
    pub player2_points: i128,

    pub winner: Option<Address>,

    pub hidden_word_id: u32,

    pub player1_guess_commitment: Option<BytesN<32>>,
    pub player2_guess_commitment: Option<BytesN<32>>
}
```

------------------------------------------------------------------------

# Starting a Game

``` rust
pub fn start_game(
    env: Env,
    session_id: u32,
    player1: Address,
    player2: Address,
    player1_points: i128,
    player2_points: i128,
) -> Result<(), Error>
```

This function:

-   Prevents self-play
-   Requires both players to authorize staking
-   Calls Game Hub start_game()
-   Derives hidden word from session_id
-   Stores state with TTL
-   Locks staked points

------------------------------------------------------------------------

# Guess Commitment

``` rust
pub fn commit_guess(
    env: Env,
    session_id: u32,
    player: Address,
    guess_commitment: BytesN<32>,
) -> Result<(), Error>
```

Players commit a hash of their guess to prevent:

-   Guess changes
-   Front-running
-   Strategic manipulation

Both commits must exist before winner settlement.

------------------------------------------------------------------------

# Noir Zero-Knowledge Circuit

``` rust
fn count_matches(hidden: [u8; 12], hidden_len: u8, guess: [u8; 3]) -> u8 {
    assert(guess[0] != guess[1]);
    assert(guess[0] != guess[2]);
    assert(guess[1] != guess[2]);

    let mut count: u8 = 0;

    for i in 0..3 {
        let g = guess[i];
        assert(g < 26);

        for j in 0..12 {
            if (j as u8) < hidden_len {
                let h = hidden[j];
                assert(h < 26);

                if h == g {
                    count += 1;
                }
            }
        }
    }

    count
}

pub fn main(
    hidden: [u8; 12],
    hidden_len: u8,
    p1_guess: [u8; 3],
    p2_guess: [u8; 3]
) -> pub u8 {
}
```

Private Inputs:

-   hidden
-   hidden_len
-   p1_guess
-   p2_guess

Public Output:

-   winner flag (1 or 2)

------------------------------------------------------------------------

# Browser-Side Proof Generation (UltraHonk)

``` typescript
import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import initNoirC from '@noir-lang/noirc_abi';
import initACVM from '@noir-lang/acvm_js';
import acvm from '@noir-lang/acvm_js/web/acvm_js_bg.wasm?url';
import noirc from '@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url';
import circuit from './alphaduel_winner_proof.json';

await Promise.all([initACVM(fetch(acvm)), initNoirC(fetch(noirc))]);

const noir = new Noir(circuitTyped);
const backend = new UltraHonkBackend(circuit.bytecode);

const { witness, returnValue } = await noir.execute({
  hidden,
  hidden_len,
  p1_guess: player1,
  p2_guess: player2
});

const proof = await backend.generateProof(witness);
const isValid = await backend.verifyProof(proof);
```

Proof generation runs entirely in the browser.

------------------------------------------------------------------------

# On-Chain Settlement

``` typescript
const tx = await client.reveal_winner_with_proof({
  session_id: sessionId,
  proof: Buffer.from(proof.proof),
  public_inputs: [winnerFlagNum],
});
```

Contract:

``` rust
pub fn reveal_winner_with_proof(
    env: Env,
    session_id: u32,
    proof: Bytes,
    public_inputs: Vec<u32>,
) -> Result<Address, Error>
```

This:

1.  Validates commitments
2.  Extracts winner flag
3.  Transfers staked points
4.  Saves winner
5.  Calls Game Hub end_game()

------------------------------------------------------------------------

# Tech Stack

ZK Circuit: Noir\
Proof Backend: UltraHonk\
Smart Contract: Soroban (Rust)\
Frontend: React 19 + TypeScript\
ZK Runtime: noir_js + bb.js (WASM)\
Wallet: Freighter\
Scaffolding: Stellar Game Studio

## Quick Start

```bash
# Fork the repo, then:
git clone https://github.com/ChielokaCode/AlphaDuel
cd AlphaDuel
bun install

# Build + deploy contracts to testnet, generate bindings, write .env
bun run build alpha-duel
bun run deploy alpha-duel
bun run bindings alpha-duel

# Run the standalone dev frontend with testnet wallet switching
bun run dev:game alpha-duel

bun run publish alpha-duel --build       # Export + build production frontend
```
## Project Structure

```
├── contracts/               # Soroban contracts for games + mock Game Hub
|-- alpha-duel-frontend      # AlphaDuel zk multiplayer word guessing game
    |--alphaduel_winner_prrof # Noir verifier main.nr
    |--backend                # Nodejs file to start websockets
├── template_frontend/       # Standalone number-guess example frontend used by create
├── <game>-frontend/         # Standalone game frontend (generated by create)
├── sgs_frontend/            # Documentation site (builds to docs/)
├── scripts/                 # Build & deployment automation
└── bindings/                # Generated TypeScript bindings
```


## Ecosystem Constraints

- AlphaDuel contract: [CC674UPBAU43Q7D4SL6GLLTMSAQOZBLPHYER5ZGDNMU3GA5P7ONNAVLK](https://stellar.expert/explorer/testnet/contract/CC674UPBAU43Q7D4SL6GLLTMSAQOZBLPHYER5ZGDNMU3GA5P7ONNAVLK?filter=history)
- AlphaDuel contract called `start_game` and `end_game` on the Game Hub contract:
  Testnet: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
- Game Hub enforces exactly two players per session.
- Keep randomness deterministic between simulation and submission.
- Prefer temporary storage with a 30-day TTL for game state.


## MIT License

[MIT License](https://github.com/ChielokaCode/AlphaDuel/blob/main/LICENSE) is added to Repo

**Built with ❤️ for Stellar developers**
