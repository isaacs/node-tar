// evil-fs: a module to make node's fs util a bit of a jerk.
// XXX this should be its own npm package
//
// All of these functions return the de-mutating restore function

const fs = require('fs')

// xenoRead()
// Make fs.read() calls return half as much data, xeno's paradox style
const xenoRead = exports.xenoRead = _ => {
  return mutate('read', (error, bytesRead) =>
                [error, bytesRead > 1 ? Math.floor(bytesRead/2) : bytesRead])
}

const constants = require('constants')
const S_IFMT   = constants.S_IFMT   || 0o170000
const S_IFREG  = constants.S_IFREG  || 0o100000
const S_IFDIR  = constants.S_IFDIR  || 0o040000
const S_IFCHR  = constants.S_IFCHR  || 0o020000
const S_IFBLK  = constants.S_IFBLK  || 0o060000
const S_IFIFO  = constants.S_IFIFO  || 0o010000
const S_IFLNK  = constants.S_IFLNK  || 0o120000
const S_IFSOCK = constants.S_IFSOCK || 0o140000
// statType(type)
// mutate stat/fstat/lstat calls to always return the specified type
// only mutates if there is no error returned by the stat call.
// Takes a type to match the `isBlank()` stat methods
// File, Directory, CharacterDevice, BlockDevice, FIFO, SymbolicLink, Socket
const statType = exports.statType = type => {
  const mode = type === 'File' ? S_IFREG
             : type === 'Directory' ? S_IFDIR
             : type === 'CharacterDevice' ? S_IFCHR
             : type === 'BlockDevice' ? S_IFBLK
             : type === 'FIFO' ? S_IFIFO
             : type === 'SymbolicLink' ? S_IFLNK
             : type === 'Socket' ? S_IFSOCK
             : null
  if (!type)
    throw new TypeError('invalid type: ' + type)
  return statMutate((error, stat) => {
    if (stat)
      stat.mode = stat.mode & (S_IFMT ^ 0o777777) | mode
  })
}

// pass(methodName, data)
// Cause fs[methodName] and fs[methodName + 'Sync'] to
// automatically pass with the data provided.
// Returns restore method
const pass = exports.pass = (method, data) => {
  const orig = fs[method]
  const origSync = fs[method + 'Sync']

  fs[method] = function () {
    const cb = arguments[arguments.length - 1]
    setTimeout(_ => cb(null, data))
  }

  fs[method + 'Sync'] = _ => {
    return data
  }

  return _ => {
    fs[method] = orig
    fs[method + 'Sync'] = origSync
  }
}

// fail(methodName, error)
// Cause specified fs method to fail with the provided error
const fail = exports.fail = (method, error) => {
  const orig = fs[method]
  const origSync = fs[method + 'Sync']

  fs[method] = function () {
    const cb = arguments[arguments.length - 1]
    setTimeout(_ => cb(error))
  }

  fs[method + 'Sync'] = _ => {
    throw error
  }

  return _ => {
    fs[method] = orig
    fs[method + 'Sync'] = origSync
  }
}

// statMutate(fn)
// Mutate all stat functions at once
const statMutate = exports.statMutate = fn => {
  const unmunge = mutate('stat', fn)
  const unmungel = mutate('lstat', fn)
  const unmungef = mutate('fstat', fn)

  return _ => unmunge(unmungel(unmungef()))
}

// mutate(method, fn)
// Apply fn(error, data) to return values from fs[method]
// If the function returns an array, it should be [newError, newData]
// If the function does not return a value, use (mutated in place) values
const mutate = exports.mutate = (method, fn) => {
  const orig = fs[method]
  const origSync = fs[method + 'Sync']

  fs[method] = function () {
    const cb = arguments[arguments.length - 1]
    arguments[arguments.length - 1] = (error, data) => {
      const mutated = fn(error, data)
      if (!mutated) // just mutate objects in-place is fine
        cb(error, data)
      else
        cb(mutated[0], mutated[1])
    }
    orig.apply(fs, arguments)
  }

  fs[method + 'Sync'] = function () {
    let result, error
    try {
      result = origSync.apply(fs, arguments)
    } catch (er) {
      error = er
    }
    const mutated = fn(error, result)
    if (mutated)
      error = mutated[0], result = mutated[1]
    if (error)
      throw error
    return result
  }

  return _ => {
    fs[method] = orig
    fs[method + 'Sync'] = origSync
  }
}
