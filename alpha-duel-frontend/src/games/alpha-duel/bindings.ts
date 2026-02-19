import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
// export * from "@stellar/stellar-sdk";
export { Keypair, TransactionBuilder, Networks, Operation, Asset } from "@stellar/stellar-sdk";

export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CAQZEXWXTC2KSIMOVZUTMSL5O3ULKDSLLF2LRWIB7GYHJWVZINVGSAC3",
  }
} as const


export interface Game {
  hidden_word_id: u32;
  player1: string;
  player1_guess: Option<Array<u32>>;
  player1_guess_commitment: Option<Buffer>;
  player1_points: i128;
  player2: string;
  player2_guess: Option<Array<u32>>;
  player2_guess_commitment: Option<Buffer>;
  player2_points: i128;
  winner: Option<string>;
}

export const Errors = {
  1: {message:"GameNotFound"},
  2: {message:"NotPlayer"},
  3: {message:"AlreadyGuessed"},
  4: {message:"BothPlayersNotGuessed"},
  5: {message:"GameAlreadyEnded"},
  6: {message:"InvalidGuessLength"},
  7: {message:"AlreadyCommitted"}
}

export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "Admin", values: void};

export interface Client {
  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the current GameHub contract address
   * 
   * # Returns
   * * `Address` - The GameHub contract address
   */
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set a new GameHub contract address
   * 
   * # Arguments
   * * `new_hub` - The new GameHub contract address
   */
  set_hub: ({new_hub}: {new_hub: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the contract WASM hash (upgrade contract)
   * 
   * # Arguments
   * * `new_wasm_hash` - The hash of the new WASM binary
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the current admin address
   * 
   * # Returns
   * * `Address` - The admin address
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set a new admin address
   * 
   * # Arguments
   * * `new_admin` - The new admin address
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a make_guess transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  make_guess: ({session_id, player, guess}: {session_id: u32, player: string, guess: Array<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_game: ({session_id, player1, player2, player1_points, player2_points}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_guess transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  commit_guess: ({session_id, player, guess_commitment}: {session_id: u32, player: string, guess_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reveal_winner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reveal_winner: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a reveal_winner_with_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reveal_winner_with_proof: ({session_id, proof, public_inputs}: {session_id: u32, proof: Buffer, public_inputs: Array<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub}: {admin: string, game_hub: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABEdhbWUAAAAKAAAAAAAAAA5oaWRkZW5fd29yZF9pZAAAAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAA1wbGF5ZXIxX2d1ZXNzAAAAAAAD6AAAA+oAAAAEAAAAAAAAABhwbGF5ZXIxX2d1ZXNzX2NvbW1pdG1lbnQAAAPoAAAD7gAAACAAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAADXBsYXllcjJfZ3Vlc3MAAAAAAAPoAAAD6gAAAAQAAAAAAAAAGHBsYXllcjJfZ3Vlc3NfY29tbWl0bWVudAAAA+gAAAPuAAAAIAAAAAAAAAAOcGxheWVyMl9wb2ludHMAAAAAAAsAAAAAAAAABndpbm5lcgAAAAAD6AAAABM=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABwAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAOQWxyZWFkeUd1ZXNzZWQAAAAAAAMAAAAAAAAAFUJvdGhQbGF5ZXJzTm90R3Vlc3NlZAAAAAAAAAQAAAAAAAAAEEdhbWVBbHJlYWR5RW5kZWQAAAAFAAAAAAAAABJJbnZhbGlkR3Vlc3NMZW5ndGgAAAAAAAYAAAAAAAAAEEFscmVhZHlDb21taXR0ZWQAAAAH",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAAVBZG1pbgAAAA==",
        "AAAAAAAAAF5HZXQgdGhlIGN1cnJlbnQgR2FtZUh1YiBjb250cmFjdCBhZGRyZXNzCgojIFJldHVybnMKKiBgQWRkcmVzc2AgLSBUaGUgR2FtZUh1YiBjb250cmFjdCBhZGRyZXNzAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAF5TZXQgYSBuZXcgR2FtZUh1YiBjb250cmFjdCBhZGRyZXNzCgojIEFyZ3VtZW50cwoqIGBuZXdfaHViYCAtIFRoZSBuZXcgR2FtZUh1YiBjb250cmFjdCBhZGRyZXNzAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAHFVcGRhdGUgdGhlIGNvbnRyYWN0IFdBU00gaGFzaCAodXBncmFkZSBjb250cmFjdCkKCiMgQXJndW1lbnRzCiogYG5ld193YXNtX2hhc2hgIC0gVGhlIGhhc2ggb2YgdGhlIG5ldyBXQVNNIGJpbmFyeQAAAAAAAAd1cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAABEdhbWUAAAAD",
        "AAAAAAAAAEhHZXQgdGhlIGN1cnJlbnQgYWRtaW4gYWRkcmVzcwoKIyBSZXR1cm5zCiogYEFkZHJlc3NgIC0gVGhlIGFkbWluIGFkZHJlc3MAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAEpTZXQgYSBuZXcgYWRtaW4gYWRkcmVzcwoKIyBBcmd1bWVudHMKKiBgbmV3X2FkbWluYCAtIFRoZSBuZXcgYWRtaW4gYWRkcmVzcwAAAAAACXNldF9hZG1pbgAAAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAKbWFrZV9ndWVzcwAAAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAVndWVzcwAAAAAAA+oAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKc3RhcnRfZ2FtZQAAAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMY29tbWl0X2d1ZXNzAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAABBndWVzc19jb21taXRtZW50AAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAA==",
        "AAAAAAAAAAAAAAANcmV2ZWFsX3dpbm5lcgAAAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAABAAAD6QAAABMAAAAD",
        "AAAAAAAAAAAAAAAYcmV2ZWFsX3dpbm5lcl93aXRoX3Byb29mAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAFcHJvb2YAAAAAAAAOAAAAAAAAAA1wdWJsaWNfaW5wdXRzAAAAAAAD6gAAAAQAAAABAAAD6QAAABMAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_hub: this.txFromJSON<string>,
        set_hub: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        get_game: this.txFromJSON<Result<Game>>,
        get_admin: this.txFromJSON<string>,
        set_admin: this.txFromJSON<null>,
        make_guess: this.txFromJSON<Result<void>>,
        start_game: this.txFromJSON<Result<void>>,
        commit_guess: this.txFromJSON<Result<void>>,
        reveal_winner: this.txFromJSON<Result<string>>,
        reveal_winner_with_proof: this.txFromJSON<Result<string>>
  }
}