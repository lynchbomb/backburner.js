import Platform from './platform';

export default class Environment {
  static forOptions(options, queueNames) {
    if (!options) {
      let defaultQueue = queueNames && queueNames[0];
      return new Environment({ handler: NO_ERROR_HANDLER, platform: Platform, defaultQueue });
    }

    let defaultQueue = options.defaultQueue || (queueNames && queueNames[0]);
    let handler = triageOnError(options);
    let GUID_KEY = options.GUID_KEY;
    let platform = options._platform || Platform;
    let onBegin = options.onBegin;
    let onEnd = options.onEnd;

    return new Environment({ handler, defaultQueue, platform, onBegin, onEnd, GUID_KEY });
  }

  constructor({ handler, defaultQueue, platform, onBegin, onEnd, GUID_KEY }) {
    this.onError = handler;
    this.defaultQueue = defaultQueue;
    this.platform = platform;
    this.onBegin = onBegin;
    this.onEnd = onEnd;
    this.GUID_KEY = GUID_KEY;
  }
}

class OnError {
  invoke(target, method, args, errorRecordedForStack) {
    let onError = this.invoker();

    try {
      if (args && args.length > 0) {
        method.apply(target, args);
      } else {
        method.call(target);
      }
    } catch(error) {
      onError(error, errorRecordedForStack);
    }
  }

  handleError(error, stack) {
    let onError = this.invoker();
    onError(error, stack);
  }
}

class FunctionOnError extends OnError {
  constructor(func) {
    super();
    this.func = func;
  }

  invoker() {
    return this.func;
  }
}

class TargetActionOnError extends OnError {
  constructor(target, method) {
    super();
    this.target = target;
    this.method = method;
  }

  invoker() {
    return this.target && this.target[this.method];
  }
}

class NoErrorHandler {
  invoker() {
    return null;
  }

  invoke(target, method, args) {
    if (args && args.length > 0) {
      method.apply(target, args);
    } else {
      method.call(target);
    }
  }

  handleError() {
    // noop
  }
}

const NO_ERROR_HANDLER = new NoErrorHandler();

function triageOnError(options) {
  if (!options) return NO_ERROR_HANDLER;

  let { onError, onErrorTarget, onErrorMethod } = options;

  if (onError) {
    return new FunctionOnError(onError);
  } else if (onErrorTarget && onErrorMethod) {
    return new TargetActionOnError(onErrorTarget, onErrorMethod);
  } else {
    return NO_ERROR_HANDLER;
  }
}
