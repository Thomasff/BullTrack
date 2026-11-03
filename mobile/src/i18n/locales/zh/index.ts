import { common } from './common';
import { settings } from './settings';
import { game } from './game';
import { setup } from './setup';
import { modes } from './modes';
import { history } from './history';
import { stats } from './stats';
import { share } from './share';
import { native } from './native';
import { debug } from './debug';
import { guide } from './guide';

// Chinese is the source language: every other language has exactly these keys.
export const zh = { common, settings, game, setup, modes, history, stats, share, native, debug, guide };

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

// TypeScript reports a key missing from (or extra in) another language.
export type Translation = Shape<typeof zh>;
