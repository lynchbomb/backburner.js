import {
  isString
} from './utils';

import Environment from './environment';

class Task {
  constructor(queue, target, method) {
    this.queue = queue;
    this.target = target;
    this.method = method;
  }
}

class CoreQueue {
  constructor(guidKey) {
    this.tasks = [];
    this.GUID_KEY = guidKey;
  } 

  hasTasks() {
    return this.tasks.length > 0;
  }

  push(target, method, args, stack) {
    let tasks = this.tasks;
    tasks.push(target, method, args, stack);

    return new Task(this, target, method);
  }

  popTasks() {
    this.targetQueues = Object.create(null);
    let tasks = this.tasks.slice();
    this.tasks = [];
    return tasks;
  }

  pushUniqueWithoutGuid(target, method, args, stack) {
    let tasks = this.tasks;

    for (let i = 0, l = tasks.length; i < l; i += 4) {
      let currentTarget = tasks[i];
      let currentMethod = tasks[i+1];

      if (currentTarget === target && currentMethod === method) {
        tasks[i+2] = args;  // replace args
        tasks[i+3] = stack; // replace stack
        return;
      }
    }

    tasks.push(target, method, args, stack);
  }

  pushTarget(targetQueue, target, method, args, stack) {
    let tasks = this.tasks;

    for (let i = 0, l = targetQueue.length; i < l; i += 2) {
      let currentMethod = targetQueue[i];
      let currentIndex  = targetQueue[i + 1];

      if (currentMethod === method) {
        tasks[currentIndex + 2] = args;  // replace args
        tasks[currentIndex + 3] = stack; // replace stack
        return;
      }
    }

    targetQueue.push(
      method,
      tasks.push(target, method, args, stack) - 4
    );
  }

  pushUniqueWithGuid(guid, target, method, args, stack) {
    let hasLocalQueue = this.targetQueues[guid];

    if (hasLocalQueue) {
      this.pushTarget(hasLocalQueue, target, method, args, stack);
    } else {
      this.targetQueues[guid] = [
        method,
        this.tasks.push(target, method, args, stack) - 4
      ];
    }

    return new Task(this, target, method);
  }

  pushUnique(target, method, args, stack) {
    let KEY = this.GUID_KEY;

    if (target && KEY) {
      let guid = target[KEY];
      if (guid) {
        return this.pushUniqueWithGuid(guid, target, method, args, stack);
      }
    }

    this.pushUniqueWithoutGuid(target, method, args, stack);

    return new Task(this, target, method);
  }

}

export default class Queue extends CoreQueue {
  constructor(name, options, env) {
    env = env || Environment.forOptions({});
    super(env && env.GUID_KEY);
    this.name = name;
    this.onError = env.onError;
    this.options = options;
    this.tasks = [];
    this.targetQueues = {};
  }

  flush(sync) {
    new Flush(this, sync, this.onError).flush();
  }

  cancel(actionToCancel) {
    return;
    // let tasks = this.tasks, currentTarget, currentMethod, i, l;
    // let target = actionToCancel.target;
    // let method = actionToCancel.method;
    // let GUID_KEY = this.GUID_KEY;

    // if (GUID_KEY && this.targetQueues && target) {
    //   let targetQueue = this.targetQueues[target[GUID_KEY]];

    //   if (targetQueue) {
    //     for (i = 0, l = targetQueue.length; i < l; i++) {
    //       if (targetQueue[i] === method) {
    //         targetQueue.splice(i, 1);
    //       }
    //     }
    //   }
    // }

    // for (i = 0, l = tasks.length; i < l; i += 4) {
    //   currentTarget = tasks[i];
    //   currentMethod = tasks[i+1];

    //   if (currentTarget === target &&
    //       currentMethod === method) {
    //     tasks.splice(i, 4);
    //     return true;
    //   }
    // }

    // // if not found in current queue
    // // could be in the queue that is being flushed
    // tasks = this._queueBeingFlushed;

    // if (!tasks) {
    //   return;
    // }

    // for (i = 0, l = tasks.length; i < l; i += 4) {
    //   currentTarget = tasks[i];
    //   currentMethod = tasks[i+1];

    //   if (currentTarget === target &&
    //       currentMethod === method) {
    //     // don't mess with array during flush
    //     // just nullify the method
    //     tasks[i+1] = null;
    //     return true;
    //   }
    // }
  }
}

class CoreMacroFlush {
  constructor(queue, sync, onError) {
    this.queue = queue;
    this.onError = onError;
    this.microTask = null;
    this.sync = sync;
    this.flushState = "initial";
  }

  shouldFlush() {
    return this.queue.tasks.length > 0;
  }

  willFlush() {}
  didFlush() {}

  flush() {
    while (this.next() !== "done");
  }

  next() {
    switch (this.flushState) {
      case 'initial':
        if (this.queue.hasTasks()) {
          this.microTask = new MicroTask(this.queue.popTasks(), this.onError);
          this.flushState = 'flushing';
        } else {
          this.flushState = 'return';
        }

        break;
      case 'flushing':
        if (this.microTask.next() === 'done') {
          this.microTask = null;
          this.flushState = 'done';
        }
        
        break;
      case 'done':
        this.flushState = this.sync === false ? 'return' : 'initial';

        break;

      case 'return':
        this.microTask = null;
        this.flushState = 'initial';
        return 'done';
    }
  }

  invokeTasks(currentTasks) {
    this.microTask.flush();
  }
}

class Flush extends CoreMacroFlush {
  constructor(queue, sync, onError, options) {
    super(queue, sync, onError);
    this.before = options && options.before;
    this.after = options && options.after;
  }

  willFlush() {
    let { before } = this;
    if (before) { before(); }
    super.willFlush();
  }

  didFlush() {
    let { after } = this;
    if (after) { after(); }
  }
}

class MicroTask {
  constructor(tasks, onError) {
    this.tasks = tasks;
    this.onError = onError;
    this.position = 0;
    this.size = tasks.length;
  }

  next() {
    let { position: i, tasks, onError } = this;

    if (i >= this.size) { return "done"; }

    let target        = tasks[i];
    let method        = tasks[i + 1];
    let args          = tasks[i + 2];
    let recordedError = tasks[i+3];

    if (isString(method)) {
      method = target[method];
    }

    // method could have been nullified / canceled during flush
    if (method) {
      //
      //    ** Attention intrepid developer **
      //
      //    To find out the stack of this task when it was scheduled onto
      //    the run loop, add the following to your app.js:
      //
      //    Ember.run.backburner.DEBUG = true; // NOTE: This slows your app, don't leave it on in production.
      //
      //    Once that is in place, when you are at a breakpoint and navigate
      //    here in the stack explorer, you can look at `errorRecordedForStack.stack`,
      //    which will be the captured stack when this job was scheduled.
      //
      onError.invoke(target, method, args, recordedError);
    }

    this.position += 4;
    return "next";
  }

  flush() {
    while (this.next() !== "done");
  }
}
