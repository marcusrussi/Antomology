'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var React = require('react');

var _require = require('../config'),
    config = _require.config;

var Dropdown = require('./components/Dropdown.react');
var Button = require('./components/Button.react');
var TaskCard = require('./TaskCard.react');

var useState = React.useState,
    useMemo = React.useMemo,
    useEffect = React.useEffect;


function StatusCard(props) {
  var state = props.state,
      dispatch = props.dispatch,
      entity = props.entity;

  var card = null;
  switch (entity.type) {
    case 'ANT':
      card = React.createElement(AntCard, props);
      break;
    case 'EGG':
      card = React.createElement(EggCard, props);
      break;
    case 'LARVA':
      card = React.createElement(LarvaCard, props);
      break;
    case 'PUPA':
      card = React.createElement(PupaCard, props);
      break;
    case 'OBELISK':
      card = React.createElement(TaskEditor, props);
      break;
    case 'LOCATION':
      card = React.createElement(LocationCard, props);
      break;
    case 'PHEROMONE':
      var edge = state.game.edges[entity.edge];
      if (edge.pheromones[0] === entity.id) {
        card = React.createElement(EdgeCard, props);
      }
      break;
  }

  return card;
}

function AntCard(props) {
  var state = props.state,
      dispatch = props.dispatch,
      entity = props.entity;

  var ant = entity;

  var hungryStr = ant.calories < config.antStartingCalories * config.antStarvationWarningThreshold ? ' - Hungry' : '';
  var deadStr = ant.alive ? '' : 'DEAD ';

  return React.createElement(
    'div',
    {
      style: {
        border: '1px solid black'
      }
    },
    React.createElement(
      'div',
      null,
      React.createElement(
        'b',
        null,
        deadStr,
        ant.subType,
        ' ',
        ant.type
      )
    ),
    React.createElement(
      'div',
      null,
      'Calories: ',
      ant.calories,
      hungryStr
    ),
    React.createElement(
      'div',
      null,
      'HP: 10/10'
    ),
    React.createElement(
      'div',
      null,
      'Current Task:',
      React.createElement(Dropdown, {
        options: state.game.tasks.map(function (task) {
          return task.name;
        }),
        selected: ant.task != null ? ant.task.name : null,
        onChange: function onChange(nextTaskName) {
          var nextTask = state.game.tasks.filter(function (t) {
            return t.name === nextTaskName;
          })[0];
          dispatch({ type: 'ASSIGN_TASK', task: nextTask, ants: [ant.id] });
        }
      }),
      React.createElement(DeselectButton, props)
    )
  );
};

function DeselectButton(props) {
  var state = props.state,
      dispatch = props.dispatch,
      entity = props.entity;

  return React.createElement(Button, {
    label: 'Deselect',
    onClick: function onClick() {
      dispatch({
        type: 'SET_SELECTED_ENTITIES',
        entityIDs: state.game.selectedEntities.filter(function (id) {
          return id != entity.id;
        })
      });
    }
  });
}

function EggCard(props) {
  var state = props.state,
      dispatch = props.dispatch,
      entity = props.entity;

  var egg = entity;

  return React.createElement(
    'div',
    {
      style: {
        border: '1px solid black'
      }
    },
    React.createElement(
      'div',
      null,
      React.createElement(
        'b',
        null,
        egg.type
      )
    ),
    React.createElement(
      'div',
      null,
      'Time to hatch: ',
      config.eggHatchAge - egg.age
    ),
    React.createElement(
      'div',
      null,
      'HP: 10/10'
    ),
    React.createElement(
      'div',
      null,
      'Will become: LARVA then ',
      egg.subType,
      ' ANT'
    ),
    React.createElement(DeselectButton, props)
  );
}

function LarvaCard(props) {
  var state = props.state,
      dispatch = props.dispatch,
      entity = props.entity;

  var larva = entity;

  var hungryStr = larva.calories < config.larvaStartingCalories * config.antStarvationWarningThreshold ? ' - Hungry' : '';
  var deadStr = larva.alive ? '' : 'DEAD ';

  return React.createElement(
    'div',
    {
      style: {
        border: '1px solid black'
      }
    },
    React.createElement(
      'div',
      null,
      React.createElement(
        'b',
        null,
        deadStr,
        larva.type
      )
    ),
    React.createElement(
      'div',
      null,
      'Calories: ',
      larva.calories,
      hungryStr
    ),
    React.createElement(
      'div',
      null,
      'Calories needed to hatch: ',
      config.larvaEndCalories - larva.calories
    ),
    React.createElement(
      'div',
      null,
      'HP: 10/10'
    ),
    React.createElement(
      'div',
      null,
      'Will become: PUPA then ',
      larva.subType,
      ' ANT'
    ),
    React.createElement(DeselectButton, props)
  );
}

function PupaCard(props) {
  var state = props.state,
      dispatch = props.dispatch,
      entity = props.entity;

  var pupa = entity;

  return React.createElement(
    'div',
    {
      style: {
        border: '1px solid black'
      }
    },
    React.createElement(
      'div',
      null,
      React.createElement(
        'b',
        null,
        pupa.type
      )
    ),
    React.createElement(
      'div',
      null,
      'Time to hatch: ',
      config.pupaHatchAge - pupa.age
    ),
    React.createElement(
      'div',
      null,
      'HP: 10/10'
    ),
    React.createElement(
      'div',
      null,
      'Will become: ',
      pupa.subType,
      ' ANT'
    ),
    React.createElement(DeselectButton, props)
  );
}

function LocationCard(props) {
  var state = props.state,
      dispatch = props.dispatch,
      entity = props.entity;

  var game = state.game;
  var loc = entity;

  var incomingEdgeInfos = loc.incomingEdges.map(function (id) {
    return game.edges[id];
  }).map(function (edge) {
    return React.createElement(
      'div',
      {
        style: { paddingLeft: 10 },
        key: "inc_" + edge.id
      },
      'Source: ',
      edge.start != null ? game.entities[edge.start].name : 'Not Set'
    );
  });
  var outgoingEdgeInfos = loc.outgoingEdges.map(function (id) {
    return game.edges[id];
  }).map(function (edge) {
    return React.createElement(
      'div',
      {
        style: { paddingLeft: 10 },
        key: "out_" + edge.id
      },
      React.createElement(
        'div',
        null,
        'Destination: ',
        edge.end != null ? game.entities[edge.end].name : 'Not Set'
      ),
      React.createElement(
        'div',
        null,
        'Condition: TODO'
      )
    );
  });

  return React.createElement(
    'div',
    {
      style: {
        border: '1px solid black'
      }
    },
    React.createElement(
      'div',
      null,
      React.createElement(
        'b',
        null,
        'LOCATION:'
      ),
      React.createElement('input', { type: 'text', value: loc.name,
        onChange: function onChange(ev) {
          dispatch({
            type: 'UPDATE_LOCATION_NAME',
            id: loc.id,
            newName: ev.target.value
          });
        } })
    ),
    React.createElement(
      'div',
      null,
      'Incoming Trails:',
      React.createElement(
        'div',
        null,
        incomingEdgeInfos
      )
    ),
    React.createElement(
      'div',
      null,
      'Outgoing Trails:',
      React.createElement(
        'div',
        null,
        outgoingEdgeInfos
      )
    )
  );
}

function EdgeCard(props) {
  var state = props.state,
      dispatch = props.dispatch,
      entity = props.entity;
  var game = state.game;

  var edge = game.edges[entity.edge];
  var startLoc = game.entities[edge.start];

  var endLocName = edge.end != null ? game.entities[edge.end].name : 'Not Set';

  return React.createElement(
    'div',
    {
      style: {
        border: '1px solid black'
      }
    },
    React.createElement(
      'div',
      null,
      React.createElement(
        'b',
        null,
        'TRAIL'
      )
    ),
    React.createElement(
      'div',
      null,
      'From: ',
      startLoc.name
    ),
    React.createElement(
      'div',
      null,
      'To: ',
      endLocName
    )
  );
}

function TaskEditor(props) {
  var state = props.state,
      dispatch = props.dispatch;
  var game = state.game;

  var _useState = useState('New Task'),
      _useState2 = _slicedToArray(_useState, 2),
      taskName = _useState2[0],
      setTaskName = _useState2[1];

  var editingTask = useMemo(function () {
    return taskName === 'New Task' ? { name: 'New Task', repeating: false, behaviorQueue: [] } : game.tasks.filter(function (t) {
      return t.name === taskName;
    })[0];
  }, [taskName]);
  return React.createElement(
    'div',
    {
      className: 'taskEditor',
      style: {
        border: '1px solid black'
      }
    },
    React.createElement(
      'div',
      null,
      React.createElement(
        'b',
        null,
        'THE OBELISK'
      )
    ),
    'Edit Task: ',
    React.createElement(Dropdown, {
      noNoneOption: true,
      options: ['New Task'].concat(game.tasks.map(function (t) {
        return t.name;
      })),
      selected: taskName,
      onChange: setTaskName
    }),
    React.createElement(TaskCard, {
      state: state,
      dispatch: dispatch,
      setTaskName: setTaskName,
      newTask: taskName === 'New Task',
      task: editingTask
    })
  );
}

module.exports = StatusCard;