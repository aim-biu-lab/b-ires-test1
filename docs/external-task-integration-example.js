/**
 * External Task Integration Example
 * ==================================
 * 
 * This file shows how to integrate an external web application
 * with the Experiment Platform's external_task stage.
 * 
 * The platform uses WebSocket for real-time bidirectional communication.
 */

// ============================================================
// MINIMAL EXAMPLE - Copy this to get started quickly
// ============================================================

(function() {
  // 1. Get task_token from URL (automatically added by platform)
  var urlParams = new URLSearchParams(window.location.search);
  var taskToken = urlParams.get('task_token');
  
  if (!taskToken) {
    console.error('No task_token found in URL - not running in experiment context');
    return;
  }

  // 2. Connect to WebSocket
  // Use platform_host param if provided (for cross-domain apps), otherwise use current host
  var platformHost = urlParams.get('platform_host') || window.location.host;
  var wsProtocol = platformHost.includes('localhost') || platformHost.startsWith('127.') ? 'ws:' : 'wss:';
  var wsUrl = wsProtocol + '//' + platformHost + '/api/ws/external-task/' + taskToken;
  var ws = new WebSocket(wsUrl);

  // 3. On connect - tell platform we're ready
  ws.onopen = function() {
    console.log('Connected to experiment platform');
    ws.send(JSON.stringify({ type: 'ready' }));
  };

  // 4. Handle messages from platform
  ws.onmessage = function(event) {
    var message = JSON.parse(event.data);
    console.log('Received:', message);
    
    if (message.type === 'init') {
      // Platform sends config (session_id, stage_id, participant_number, etc.)
      console.log('Config received:', message.payload);
    }
    
    if (message.type === 'command') {
      // Platform sends commands (restart, close, pause, resume)
      handleCommand(message.payload.command);
    }
  };

  // 5. Complete the task (call this when user finishes)
  window.completeTask = function(results) {
    ws.send(JSON.stringify({
      type: 'complete',
      payload: { data: results || {} }
    }));
  };

  // 6. Handle platform commands
  function handleCommand(command) {
    console.log('Command received:', command);
    
    if (command === 'restart') {
      // Reset your task
      location.reload();
    }
    if (command === 'close') {
      // Cleanup and close
      window.close();
    }
    
    // Acknowledge the command
    ws.send(JSON.stringify({
      type: 'command_ack',
      payload: { command: command, success: true }
    }));
  }
})();


// ============================================================
// EXAMPLE USAGE IN YOUR HTML
// ============================================================
/*
<!DOCTYPE html>
<html>
<head>
  <title>My External Task</title>
</head>
<body>
  <h1>My Task</h1>
  <button onclick="completeTask({ score: 100, answer: 'done' })">
    Finish Task
  </button>
  
  <script src="external-task-integration-example.js"></script>
</body>
</html>
*/


// ============================================================
// FULL EXAMPLE WITH ALL FEATURES
// ============================================================

var ExternalTaskSimple = {
  ws: null,
  config: null,

  // Initialize and connect
  init: function() {
    var urlParams = new URLSearchParams(window.location.search);
    var taskToken = urlParams.get('task_token');
    
    if (!taskToken) {
      console.warn('No task_token - running outside experiment');
      return false;
    }

    // Use platform_host param if provided (for cross-domain apps), otherwise use current host
    var platformHost = urlParams.get('platform_host') || window.location.host;
    var wsProtocol = platformHost.includes('localhost') || platformHost.startsWith('127.') ? 'ws:' : 'wss:';
    var wsUrl = wsProtocol + '//' + platformHost + '/api/ws/external-task/' + taskToken;
    
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = this._onOpen.bind(this);
    this.ws.onmessage = this._onMessage.bind(this);
    this.ws.onclose = this._onClose.bind(this);
    this.ws.onerror = this._onError.bind(this);
    
    return true;
  },

  _onOpen: function() {
    console.log('[ExternalTask] Connected');
    this._send({ type: 'ready' });
  },

  _onMessage: function(event) {
    var message = JSON.parse(event.data);
    
    switch (message.type) {
      case 'init':
        this.config = message.payload;
        console.log('[ExternalTask] Init config:', this.config);
        if (this.onInit) this.onInit(this.config);
        break;
        
      case 'command':
        this._handleCommand(message.payload);
        break;
    }
  },

  _onClose: function() {
    console.log('[ExternalTask] Disconnected');
  },

  _onError: function(error) {
    console.error('[ExternalTask] Error:', error);
  },

  _handleCommand: function(payload) {
    var command = payload.command;
    var success = false;
    
    switch (command) {
      case 'restart':
        if (this.onRestart) {
          this.onRestart();
          success = true;
        }
        break;
      case 'close':
        if (this.onClose) {
          this.onClose();
          success = true;
        } else {
          window.close();
          success = true;
        }
        break;
      case 'pause':
        if (this.onPause) {
          this.onPause();
          success = true;
        }
        break;
      case 'resume':
        if (this.onResume) {
          this.onResume();
          success = true;
        }
        break;
    }
    
    this._send({
      type: 'command_ack',
      payload: { command: command, success: success }
    });
  },

  _send: function(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      message.timestamp = new Date().toISOString();
      this.ws.send(JSON.stringify(message));
    }
  },

  // --- Public API ---

  // Report progress (0-100)
  progress: function(percent, step) {
    this._send({
      type: 'progress',
      payload: { progress: percent, step: step || null }
    });
  },

  // Log an event
  log: function(eventType, data) {
    this._send({
      type: 'log',
      payload: { event_type: eventType, data: data || {} }
    });
  },

  // Complete the task with results
  complete: function(data) {
    this._send({
      type: 'complete',
      payload: { data: data || {} }
    });
  },

  // --- Callbacks (override these) ---
  onInit: null,     // function(config) - called when config received
  onRestart: null,  // function() - called when platform requests restart
  onClose: null,    // function() - called when platform requests close
  onPause: null,    // function() - called when platform requests pause
  onResume: null    // function() - called when platform requests resume
};


// ============================================================
// FULL EXAMPLE USAGE
// ============================================================
/*
<script src="external-task-integration-example.js"></script>
<script>
  // Initialize
  ExternalTaskSimple.init();
  
  // Handle config from platform
  ExternalTaskSimple.onInit = function(config) {
    console.log('Participant:', config.participant_number);
    startMyTask();
  };
  
  // Handle restart command
  ExternalTaskSimple.onRestart = function() {
    resetMyTask();
  };
  
  // During task - log events
  document.getElementById('btn').onclick = function() {
    ExternalTaskSimple.log('button_click', { id: 'btn' });
  };
  
  // Report progress
  function onStepDone(step, total) {
    ExternalTaskSimple.progress((step / total) * 100, 'step_' + step);
  }
  
  // When done - complete with results
  function finishTask() {
    ExternalTaskSimple.complete({
      score: 95,
      answers: ['a', 'b', 'c'],
      duration_ms: 12345
    });
  }
</script>
*/


// ============================================================
// MESSAGE TYPES REFERENCE
// ============================================================
/*
SEND (External App -> Platform):
  { type: 'ready' }                                    // Required - send on connect
  { type: 'progress', payload: { progress: 75 } }      // Optional - progress 0-100
  { type: 'log', payload: { event_type: 'x', data: {} } }  // Optional - log events
  { type: 'complete', payload: { data: { ... } } }     // Required - task done
  { type: 'command_ack', payload: { command: 'x', success: true } }  // Required - ack commands

RECEIVE (Platform -> External App):
  { type: 'init', payload: { session_id, stage_id, participant_number, config } }
  { type: 'command', payload: { command: 'restart' } }
  { type: 'command', payload: { command: 'close' } }
  { type: 'command', payload: { command: 'pause' } }
  { type: 'command', payload: { command: 'resume' } }
*/
