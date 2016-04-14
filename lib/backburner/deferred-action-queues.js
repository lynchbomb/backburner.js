import {
  each
} from './utils';
import Queue from './queue';

export default class DeferredActionQueues {
  constructor(queueNames, options, env) {
    var queues = this.queues = {};
    this.queueNames = queueNames = queueNames || [];

    this.env = env;

    each(queueNames, function(queueName) {
      queues[queueName] = new Queue(queueName, options && options[queueName], env);
    });
  }

  schedule(name, target, method, args, onceFlag, stack) {
    var queues = this.queues;
    var queue = queues[name];

    if (!queue) {
      noSuchQueue(name);
    }

    if (!method) {
      noSuchMethod(name);
    }

    if (onceFlag) {
      return queue.pushUnique(target, method, args, stack);
    } else {
      return queue.push(target, method, args, stack);
    }
  }

  flush() {
    var queues = this.queues;
    var queueNames = this.queueNames;
    var queueName, queue;
    var queueNameIndex = 0;
    var numberOfQueues = queueNames.length;

    while (queueNameIndex < numberOfQueues) {
      queueName = queueNames[queueNameIndex];
      queue = queues[queueName];

      var tasksSize = queue.tasks.length;

      if (tasksSize === 0) {
        queueNameIndex++;
      } else {
        queue.flush(false /* async */);
        queueNameIndex = 0;
      }
    }
  }
}

function noSuchQueue(name) {
  throw new Error('You attempted to schedule an action in a queue (' + name + ') that doesn\'t exist');
}

function noSuchMethod(name) {
  throw new Error('You attempted to schedule an action in a queue (' + name + ') for a method that doesn\'t exist');
}
