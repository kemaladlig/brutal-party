/**
 * Brutal Party - Core Type Definitions for Agents and Engines
 */

export type SlotKind = 'human' | 'bot' | 'empty' | 'bot_normal' | 'bot_god';

export interface PlayerSlot {
  slotIndex: number;
  name: string;
  color: string;
  kind: SlotKind;
  isReady: boolean;
}

export interface RemoteInputData {
  action?: string;
  x?: number;
  y?: number;
  angle?: number;
  force?: number;
  btnA?: boolean;
  btnB?: boolean;
  position?: number;
  inverted?: boolean;
}

export interface EnginePacket {
  scores?: number[];
  [key: string]: unknown;
}

export interface EngineContract {
  game: unknown;
  reset: () => void;
  onEnter?: (now: number) => void;
  onResume?: (now: number) => void;
  start: () => void;
  packet: () => EnginePacket;
  worldPacket?: () => EnginePacket;
}

export interface Cartridge {
  id: string;
  title: string;
  retired?: boolean;
  lobbyTitle?: string;
  hudTag: string;
  tacticalHintKey: string;
  color: string;
  schema?: unknown;
  worldView?: { load: () => Promise<unknown> };
  load: () => Promise<unknown>;
  createEngine: (gameInstance: unknown) => EngineContract;
}
