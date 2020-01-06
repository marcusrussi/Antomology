// @flow

const {initState} = require('../state/initState');
const {initGameState} = require('../state/initGameState');
const {gameReducer} = require('./gameReducer');
const {tickReducer} = require('./tickReducer');
const {modalReducer} = require('./modalReducer');

import type {State, Action} from '../types';

const rootReducer = (state: State, action: Action): State => {
  if (state === undefined) return initState();

  switch (action.type) {
    case 'START':
      return {
        ...state,
        game: initGameState(),
      };
    case 'SET_MODAL':
    case 'DISMISS_MODAL':
      return modalReducer(state, action);
    case 'START_TICK':
    case 'STOP_TICK':
    case 'TICK':
      if (!state.game) return state;
      return {
        ...state,
        game: tickReducer(state.game, action),
      };
    case 'CREATE_ENTITY':
    case 'DESTROY_ENTITY':
    case 'CREATE_ANT':
    case 'DESTROY_ANT':
    case 'SET_SELECTED_ENTITIES':
    case 'CREATE_TASK':
    case 'ASSIGN_TASK':
    case 'SET_USER_MODE':
    case 'SET_ANT_MODE':
    case 'MARK_ENTITY':
    case 'SET_MOUSE_DOWN':
    case 'SET_MOUSE_POS':
      if (!state.game) return state;
      return {
        ...state,
        game: gameReducer(state.game, action),
      };
  }
  return state;
};

module.exports = {rootReducer}