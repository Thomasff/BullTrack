import type { Translation } from '../zh';

export const setup: Translation['setup'] = {
  tabs: {
    home: 'Home',
    stats: 'Stats',
    settings: 'Settings',
  },
  screens: {
    chooseMode: 'Choose mode',
    playerSetup: 'Setup',
    game: 'Game',
    debug: 'Debug images',
    matchDetail: 'Match details',
    playerStats: 'Player stats',
    headToHead: 'Head to head',
    allMatches: 'All matches',
    share: 'Share',
  },
  viewDebug: 'View debug images',
  solo: 'Solo',
  team: 'Teams',
  teamHint:
    'Teams take turns, and team members throw in order; each team shares one score. {{players}} / {{max}} players',
  teamName: 'Team {{letter}}',
  removeTeam: 'Remove',
  addMember: '+ Add member',
  addTeam: '+ Add team',
  players: 'Players',
  addPlayer: '+ Add player',
  duplicateName: 'Duplicate name: {{name}}',
  minPlayers: 'This game needs at least {{min}} players',
  knownPlayers: 'Past players',
  start: 'Start',
  board: {
    title: 'Board type',
    message: "Pick the one with your board's colours",
    softDescription: 'Red and blue rings',
    steelDescription: 'Red and green rings',
  },
  playerEdit: {
    editTitle: 'Edit player',
    namePlaceholder: 'Name',
    deletePlayer: 'Delete this player',
    saveFailed: 'Saving failed, please try again',
    nameEmpty: 'The name cannot be empty',
    nameReserved: 'Names like "Player 2" are kept for unnamed seats; please pick another',
    mergeTitle: 'Merge players',
    mergeMessage:
      '"{{to}}" already exists. Merging moves all matches and stats of "{{from}}" to "{{to}}". This cannot be undone.',
    merge: 'Merge',
    mergeConflict: '"{{from}}" and "{{to}}" played in the same match, so they cannot be merged',
    deleteTitle: 'Delete player',
    deleteMessage:
      '"{{name}}" is removed from stats and past players; their matches are kept. Finishing a game under this name later brings them back.',
  },
};
