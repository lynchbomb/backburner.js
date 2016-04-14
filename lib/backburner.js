import {
  each,
  isString,
  isFunction,
  isNumber,
  isCoercableNumber
} from './backburner/utils';

import Environment from './backburner/environment';
import searchTimer from './backburner/binary-search';
import DeferredActionQueues from './backburner/deferred-action-queues';

export class CoreBackburner {
  constructor() {
    this.instanceStack = [];
  }

  begin() {
    let previousInstance = this.currentInstance;

    if (previousInstance) {
      this.instanceStack.push(previousInstance);
    }

    this.currentInstance = this.newInstance();
  }

  end() {
    let currentInstance = this.currentInstance;
    let nextInstance = null;

    // Prevent double-finally bug in Safari 6.0.2 and iOS 6
    // This bug appears to be resolved in Safari 6.0.5 and iOS 7
    let finallyAlreadyCalled = false;
    try {
      currentInstance.flush();
    } finally {
      if (!finallyAlreadyCalled) {
        finallyAlreadyCalled = true;

        this.currentInstance = null;

        if (this.instanceStack.length) {
          nextInstance = this.instanceStack.pop();
          this.currentInstance = nextInstance;
        }
      }
    }    
  }
}

export default class Backburner extends CoreBackburner {
  constructor(queueNames, options) {
    super();
    this.queueNames = queueNames;
    // this.options = options || {};
    this.env = Environment.forOptions(options, queueNames);
    this._platform = this.env.platform;

    this.instanceStack = [];
    this._debouncees = [];
    this._throttlers = [];
    this._eventCallbacks = {
      end: [],
      begin: []
    };

    let _this = this;
    this._boundClearItems = function() {
      clearItems();
    };

    this._timerTimeoutId = undefined;
    this._timers = [];

    this._boundRunExpiredTimers = function () {
      _this._runExpiredTimers();
    };
  }

  begin() {
    let onBegin = this.env.onBegin;
    let previousInstance = this.currentInstance;

    super.begin();

    this._trigger('begin', this.currentInstance, previousInstance);
    if (onBegin) {
      onBegin(this.currentInstance, previousInstance);
    }
  }

  end() {
    let onEnd = this.env.onEnd;
    let currentInstance = this.currentInstance;

    super.end();

    this._trigger('end', currentInstance, this.currentInstance);
    if (onEnd) {
      onEnd(currentInstance, this.currentInstance);
    }
  }

  newInstance() {
    return new DeferredActionQueues(this.queueNames, this.env);
  }

  /**
   Trigger an event. Supports up to two arguments. Designed around
   triggering transition events from one run loop instance to the
   next, which requires an argument for the first instance and then
   an argument for the next instance.

   @private
   @method _trigger
   @param {String} eventName
   @param {any} arg1
   @param {any} arg2
   */
  _trigger(eventName, arg1, arg2) {
    let callbacks = this._eventCallbacks[eventName];
    if (callbacks) {
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i](arg1, arg2);
      }
    }
  }

  on(eventName, callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    let callbacks = this._eventCallbacks[eventName];
    if (callbacks) {
      callbacks.push(callback);
    } else {
      throw new TypeError('Cannot on() event "' + eventName + '" because it does not exist');
    }
  }

  off(eventName, callback) {
    if (eventName) {
      let callbacks = this._eventCallbacks[eventName];
      let callbackFound = false;
      if (!callbacks) return;
      if (callback) {
        for (let i = 0; i < callbacks.length; i++) {
          if (callbacks[i] === callback) {
            callbackFound = true;
            callbacks.splice(i, 1);
            i--;
          }
        }
      }
      if (!callbackFound) {
        throw new TypeError('Cannot off() callback that does not exist');
      }
    } else {
      throw new TypeError('Cannot off() event "' + eventName + '" because it does not exist');
    }
  }

  run(/* target, method, args */) {
    let length = arguments.length;
    let method, target, args;

    if (length === 1) {
      method = arguments[0];
      target = null;
    } else {
      target = arguments[0];
      method = arguments[1];
    }

    if (isString(method)) {
      method = target[method];
    }

    if (length > 2) {
      args = new Array(length - 2);
      for (let i = 0, l = length - 2; i < l; i++) {
        args[i] = arguments[i + 2];
      }
    } else {
      args = [];
    }

    let onError = this.env.onError;

    this.begin();

    // guard against Safari 6's double-finally bug
    let didFinally = false;

    if (onError) {
      try {
        return method.apply(target, args);
      } catch(error) {
        onError.handleError(error);
      } finally {
        if (!didFinally) {
          didFinally = true;
          this.end();
        }
      }
    } else {
      try {
        return method.apply(target, args);
      } finally {
        if (!didFinally) {
          didFinally = true;
          this.end();
        }
      }
    }
  }

  /*
    Join the passed method with an existing queue and execute immediately,
    if there isn't one use `Backburner#run`.
 
    The join method is like the run method except that it will schedule into
    an existing queue if one already exists. In either case, the join method will
    immediately execute the passed in function and return its result.

    @method join 
    @param {Object} target
    @param {Function} method The method to be executed 
    @param {any} args The method arguments
    @return method result
  */
  join(/* target, method, args */) {
    if (!this.currentInstance) {
      return this.run.apply(this, arguments);
    }

    let length = arguments.length;
    let method, target;

    if (length === 1) {
      method = arguments[0];
      target = null;
    } else {
      target = arguments[0];
      method = arguments[1];
    }

    if (isString(method)) {
      method = target[method];
    }

    if (length === 1) {
      return method();
    } else if (length === 2) {
      return method.call(target);
    } else {
      let args = new Array(length - 2);
      for (let i = 0, l = length - 2; i < l; i++) {
        args[i] = arguments[i + 2];
      }
      return method.apply(target, args);
    }
  }


  /*
    Defer the passed function to run inside the specified queue.

    @method defer 
    @param {String} queueName 
    @param {Object} target
    @param {Function|String} method The method or method name to be executed 
    @param {any} args The method arguments
    @return method result
  */
  defer(queueName /* , target, method, args */) {
    let length = arguments.length;
    let method, target, args;

    if (length === 2) {
      method = arguments[1];
      target = null;
    } else {
      target = arguments[1];
      method = arguments[2];
    }

    if (isString(method)) {
      method = target[method];
    }

    let stack = this.DEBUG ? new Error() : undefined;

    if (length > 3) {
      args = new Array(length - 3);
      for (let i = 3; i < length; i++) {
        args[i-3] = arguments[i];
      }
    } else {
      args = undefined;
    }

    if (!this.currentInstance) { createAutorun(this); }
    return this.currentInstance.schedule(queueName, target, method, args, false, stack);
  }

  deferOnce(queueName /* , target, method, args */) {
    let length = arguments.length;
    let method, target, args;

    if (length === 2) {
      method = arguments[1];
      target = null;
    } else {
      target = arguments[1];
      method = arguments[2];
    }

    if (isString(method)) {
      method = target[method];
    }

    let stack = this.DEBUG ? new Error() : undefined;

    if (length > 3) {
      args = new Array(length - 3);
      for (let i = 3; i < length; i++) {
        args[i-3] = arguments[i];
      }
    } else {
      args = undefined;
    }

    if (!this.currentInstance) {
      createAutorun(this);
    }
    return this.currentInstance.schedule(queueName, target, method, args, true, stack);
  }

  setTimeout() {
    let l = arguments.length;
    let args = new Array(l);

    for (let x = 0; x < l; x++) {
      args[x] = arguments[x];
    }

    let length = args.length,
        method, wait, target,
        methodOrTarget, methodOrWait, methodOrArgs;

    if (length === 0) {
      return;
    } else if (length === 1) {
      method = args.shift();
      wait = 0;
    } else if (length === 2) {
      methodOrTarget = args[0];
      methodOrWait = args[1];

      if (isFunction(methodOrWait) || isFunction(methodOrTarget[methodOrWait])) {
        target = args.shift();
        method = args.shift();
        wait = 0;
      } else if (isCoercableNumber(methodOrWait)) {
        method = args.shift();
        wait = args.shift();
      } else {
        method = args.shift();
        wait =  0;
      }
    } else {
      let last = args[args.length - 1];

      if (isCoercableNumber(last)) {
        wait = args.pop();
      } else {
        wait = 0;
      }

      methodOrTarget = args[0];
      methodOrArgs = args[1];

      if (isFunction(methodOrArgs) || (isString(methodOrArgs) &&
                                      methodOrTarget !== null &&
                                      methodOrArgs in methodOrTarget)) {
        target = args.shift();
        method = args.shift();
      } else {
        method = args.shift();
      }
    }

    let executeAt = Date.now() + parseInt(wait, 10);

    if (isString(method)) {
      method = target[method];
    }

    let onError = this.env.onError;

    function fn() {
      onError.invoke(target, method, args);
    }

    return this._setTimeout(fn, executeAt);
  }

  _setTimeout(fn, executeAt) {
    if (this._timers.length === 0) {
      this._timers.push(executeAt, fn);
      this._installTimerTimeout();
      return fn;
    }

    // find position to insert
    let i = searchTimer(executeAt, this._timers);

    this._timers.splice(i, 0, executeAt, fn);

    // we should be the new earliest timer if i == 0
    if (i === 0) {
      this._reinstallTimerTimeout();
    }

    return fn;
  }

  throttle(target, method /* , args, wait, [immediate] */) {
    let backburner = this;
    let args = new Array(arguments.length);
    for (let i = 0; i < arguments.length; i++) {
      args[i] = arguments[i];
    }
    let immediate = args.pop();
    let wait, throttler, index, timer;

    if (isNumber(immediate) || isString(immediate)) {
      wait = immediate;
      immediate = true;
    } else {
      wait = args.pop();
    }

    wait = parseInt(wait, 10);

    index = findThrottler(target, method, this._throttlers);
    if (index > -1) { return this._throttlers[index]; } // throttled

    timer = this._platform.setTimeout(function() {
      if (!immediate) {
        backburner.run.apply(backburner, args);
      }
      let index = findThrottler(target, method, backburner._throttlers);
      if (index > -1) {
        backburner._throttlers.splice(index, 1);
      }
    }, wait);

    if (immediate) {
      this.run.apply(this, args);
    }

    throttler = [target, method, timer];

    this._throttlers.push(throttler);

    return throttler;
  }

  debounce(target, method /* , args, wait, [immediate] */) {
    let backburner = this;
    let args = new Array(arguments.length);
    for (let i = 0; i < arguments.length; i++) {
      args[i] = arguments[i];
    }

    let immediate = args.pop();
    let wait, index, debouncee, timer;

    if (isNumber(immediate) || isString(immediate)) {
      wait = immediate;
      immediate = false;
    } else {
      wait = args.pop();
    }

    wait = parseInt(wait, 10);
    // Remove debouncee
    index = findDebouncee(target, method, this._debouncees);

    if (index > -1) {
      debouncee = this._debouncees[index];
      this._debouncees.splice(index, 1);
      this._platform.clearTimeout(debouncee[2]);
    }

    timer = this._platform.setTimeout(function() {
      if (!immediate) {
        backburner.run.apply(backburner, args);
      }
      let index = findDebouncee(target, method, backburner._debouncees);
      if (index > -1) {
        backburner._debouncees.splice(index, 1);
      }
    }, wait);

    if (immediate && index === -1) {
      backburner.run.apply(backburner, args);
    }

    debouncee = [
      target,
      method,
      timer
    ];

    backburner._debouncees.push(debouncee);

    return debouncee;
  }

  cancelTimers() {
    each(this._throttlers, this._boundClearItems);
    this._throttlers = [];

    each(this._debouncees, this._boundClearItems);
    this._debouncees = [];

    this._clearTimerTimeout();
    this._timers = [];

    if (this._autorun) {
      this._platform.clearTimeout(this._autorun);
      this._autorun = null;
    }
  }

  hasTimers() {
    return !!this._timers.length || !!this._debouncees.length || !!this._throttlers.length || this._autorun;
  }

  cancel(timer) {
    let timerType = typeof timer;

    if (timer && timerType === 'object' && timer.queue && timer.method) { // we're cancelling a deferOnce
      return timer.queue.cancel(timer);
    } else if (timerType === 'function') { // we're cancelling a setTimeout
      for (let i = 0, l = this._timers.length; i < l; i += 2) {
        if (this._timers[i + 1] === timer) {
          this._timers.splice(i, 2); // remove the two elements
          if (i === 0) {
            this._reinstallTimerTimeout();
          }
          return true;
        }
      }
    } else if (Object.prototype.toString.call(timer) === '[object Array]'){ // we're cancelling a throttle or debounce
      return this._cancelItem(findThrottler, this._throttlers, timer) ||
               this._cancelItem(findDebouncee, this._debouncees, timer);
    } else {
      return; // timer was null or not a timer
    }
  }

  _cancelItem(findMethod, array, timer){
    let item, index;

    if (timer.length < 3) { return false; }

    index = findMethod(timer[0], timer[1], array);

    if (index > -1) {

      item = array[index];

      if (item[2] === timer[2]) {
        array.splice(index, 1);
        this._platform.clearTimeout(timer[2]);
        return true;
      }
    }

    return false;
  }

  _runExpiredTimers() {
    this._timerTimeoutId = undefined;
    this.run(this, this._scheduleExpiredTimers);
  }

  _scheduleExpiredTimers() {
    let n = Date.now();
    let timers = this._timers;
    let i = 0;
    let l = timers.length;
    for (; i < l; i += 2) {
      let executeAt = timers[i];
      let fn = timers[i+1];
      if (executeAt <= n) {
        this.schedule(this.env.defaultQueue, null, fn);
      } else {
        break;
      }
    }
    timers.splice(0, i);
    this._installTimerTimeout();
  }

  _reinstallTimerTimeout() {
    this._clearTimerTimeout();
    this._installTimerTimeout();
  }

  _clearTimerTimeout() {
    if (!this._timerTimeoutId) {
      return;
    }
    this._platform.clearTimeout(this._timerTimeoutId);
    this._timerTimeoutId = undefined;
  }

  _installTimerTimeout() {
    if (!this._timers.length) {
      return;
    }
    let minExpiresAt = this._timers[0];
    let n = Date.now();
    let wait = Math.max(0, minExpiresAt - n);
    this._timerTimeoutId = this._platform.setTimeout(this._boundRunExpiredTimers, wait);
  }
}

Backburner.prototype.schedule = Backburner.prototype.defer;
Backburner.prototype.scheduleOnce = Backburner.prototype.deferOnce;
Backburner.prototype.later = Backburner.prototype.setTimeout;

function createAutorun(backburner) {
  backburner.begin();
  backburner._autorun = backburner._platform.setTimeout(function() {
    backburner._autorun = null;
    backburner.end();
  });
}

function findDebouncee(target, method, debouncees) {
  return findItem(target, method, debouncees);
}

function findThrottler(target, method, throttlers) {
  return findItem(target, method, throttlers);
}

function findItem(target, method, collection) {
  let item;
  let index = -1;

  for (let i = 0, l = collection.length; i < l; i++) {
    item = collection[i];
    if (item[0] === target && item[1] === method) {
      index = i;
      break;
    }
  }

  return index;
}

function clearItems(item) {
  this._platform.clearTimeout(item[2]);
}

