'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _require = require('../config'),
    config = _require.config;

var _require2 = require('../selectors/selectors'),
    collidesWith = _require2.collidesWith,
    getSelectedAntIDs = _require2.getSelectedAntIDs,
    getEntitiesByType = _require2.getEntitiesByType;

var _require3 = require('../utils/canvasHelpers'),
    canvasToGrid = _require3.canvasToGrid,
    gridToCanvas = _require3.gridToCanvas;

var _require4 = require('../utils/vectors'),
    add = _require4.add,
    subtract = _require4.subtract;

var _require5 = require('../entities/location'),
    makeLocation = _require5.makeLocation;

var _require6 = require('../state/tasks'),
    createGoToLocationTask = _require6.createGoToLocationTask,
    createDoAction = _require6.createDoAction;

var initMouseControlsSystem = function initMouseControlsSystem(store) {
  var dispatch = store.dispatch;


  var canvas = null;
  document.onmouseup = function (ev) {
    var state = store.getState();
    var gridPos = getClickedPos(ev);
    if (gridPos == null) return;

    if (ev.button == 0) {
      // left click
      dispatch({ type: 'SET_MOUSE_DOWN', isLeft: true, isDown: false });
      handleLeftClick(state, dispatch, gridPos);
    } else if (ev.button == 2) {
      // right click
      dispatch({ type: 'SET_MOUSE_DOWN', isLeft: false, isDown: false });
      handleRightClick(state, dispatch, gridPos);
    }
  };

  document.onmousedown = function (ev) {
    var state = store.getState();
    var gridPos = getClickedPos(ev);
    if (gridPos == null) return;

    if (ev.button == 0) {
      // left click
      dispatch({ type: 'SET_MOUSE_DOWN', isLeft: true, isDown: true, downPos: gridPos });
    } else if (ev.button == 2) {
      // right click
      dispatch({ type: 'SET_MOUSE_DOWN', isLeft: false, isDown: true, downPos: gridPos });
    }
  };

  document.onmousemove = function (ev) {
    var state = store.getState();
    var gridPos = getClickedPos(ev);
    if (gridPos == null) return;
    dispatch({ type: 'SET_MOUSE_POS', curPos: gridPos });
    if (state.game.mouse.isLeftDown && state.game.userMode === 'MARK') {
      var clickedEntities = collidesWith({ position: gridPos, width: 1, height: 1 }, getEntitiesByType(state.game, ['DIRT']));
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = clickedEntities[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var clickedEntity = _step.value;

          dispatch({
            type: 'MARK_ENTITY',
            entityID: clickedEntity.id,
            quantity: 1
          });
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }
    }
  };
};

var canvas = null;
var getClickedPos = function getClickedPos(ev) {
  if (!canvas) {
    canvas = document.getElementById('canvas');
    // don't open the normal right-click menu
    canvas.addEventListener('contextmenu', function (ev) {
      return ev.preventDefault();
    });
    if (!canvas) {
      return null;
    }
  }
  var rect = canvas.getBoundingClientRect();

  var canvasPos = {
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top
  };
  // return null if clicked outside the canvas:
  if (canvasPos.x < 0 || canvasPos.y < 0 || canvasPos.x > config.canvasWidth || canvasPos.y > config.canvasHeight) {
    return null;
  }
  return canvasToGrid(canvasPos);
};

var handleLeftClick = function handleLeftClick(state, dispatch, gridPos) {
  // handle creating locations
  if (state.game.userMode === 'CREATE_LOCATION') {
    var dimensions = subtract(gridPos, state.game.mouse.downPos);
    var locPosition = _extends({}, state.game.mouse.downPos);
    if (dimensions.x < 0) {
      locPosition.x = locPosition.x + dimensions.x;
    }
    if (dimensions.y < 0) {
      locPosition.y = locPosition.y + dimensions.y;
    }
    var newLocation = makeLocation('test', // TODO
    Math.abs(dimensions.x) + 1, // off by one
    Math.abs(dimensions.y) + 1, locPosition);
    dispatch({ type: 'CREATE_ENTITY', entity: newLocation });
    return;
  } else if (state.game.userMode === 'SELECT') {
    // handle selecting ants
    var mouse = state.game.mouse;

    var dims = subtract(mouse.curPos, mouse.downPos);
    var x = dims.x > 0 ? mouse.downPos.x : mouse.curPos.x;
    var y = dims.y > 0 ? mouse.downPos.y : mouse.curPos.y;
    var clickedAnts = collidesWith({ position: { x: x, y: y }, width: Math.abs(dims.x) + 1, height: Math.abs(dims.y) + 1 }, getEntitiesByType(state.game, ['ANT']));
    if (clickedAnts.length > 0) {
      dispatch({
        type: 'SET_SELECTED_ENTITIES',
        entityIDs: clickedAnts.slice(0, config.maxSelectableAnts).map(function (entity) {
          return entity.id;
        })
      });
    } else if (state.game.selectedEntities.length > 0) {
      dispatch({
        type: 'SET_SELECTED_ENTITIES',
        entityIDs: []
      });
    }
  }
};

var handleRightClick = function handleRightClick(state, dispatch, gridPos) {
  var selectedAntIDs = getSelectedAntIDs(state.game);
  var clickedEntity = collidesWith({ position: gridPos, width: 1, height: 1 }, getEntitiesByType(state.game, config.antPickupEntities))[0];
  var clickedFood = collidesWith({ position: gridPos, width: 1, height: 1 }, getEntitiesByType(state.game, config.antEatEntities))[0];
  // TODO add config for which entities block the ant
  var blocked = clickedEntity != null || clickedFood != null;

  var clickedLocation = {
    id: -1,
    name: 'Clicked Position',
    position: blocked ? add(gridPos, { x: -1, y: -1 }) : gridPos,
    width: blocked ? 3 : 1,
    height: blocked ? 3 : 1
  };
  if (selectedAntIDs.length > 0) {
    var task = createGoToLocationTask(clickedLocation);
    var eatClicked = createDoAction('EAT', clickedFood);
    var pickupClicked = createDoAction('PICKUP', clickedEntity);
    var putdownClicked = createDoAction('PUTDOWN', { position: gridPos });
    if (state.game.antMode === 'EAT') {
      task.behaviorQueue.push(eatClicked);
    } else if (state.game.antMode === 'PICKUP') {
      task.behaviorQueue.push({
        type: 'CONDITIONAL',
        condition: {
          type: 'HOLDING',
          comparator: 'EQUALS',
          payload: {
            object: 'NOTHING'
          }
        },
        behavior: pickupClicked,
        elseBehavior: putdownClicked
      });
    } else if (state.game.antMode === 'FEED') {
      // TODO implement ants feeding each other
    }
    dispatch({
      type: 'ASSIGN_TASK',
      ants: selectedAntIDs,
      task: task
    });
  }
};

module.exports = { initMouseControlsSystem: initMouseControlsSystem };