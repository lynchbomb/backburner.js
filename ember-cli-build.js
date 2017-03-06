/* globals module, require */
'use strict';
const MergeTrees = require('broccoli-merge-trees');
const Funnel = require('broccoli-funnel');
const Rollup = require('broccoli-rollup');
const path = require('path');
const typescript = require('broccoli-typescript-compiler');


module.exports = function () {  
  //grabbing the entire `./lib` directory
  //compiling from typescript to es6 target
  //saving to the lib variable
  const lib = typescript(path.join(__dirname, '/lib'), {
    tsconfig: {
      compilerOptions: {
        module: 'es6',
        target: 'es6',
        removeComments: true,
        moduleResolution: 'node'
      }
    }
  });
  const libES5 = typescript(path.join(__dirname, '/lib'), {
    tsconfig: {
      compilerOptions: {
        module: 'amd',
        target: 'es5',
        removeComments: true,
        moduleResolution: 'node'
      }
    }
  });


  return new MergeTrees([
    //grabbing `index.js` within the lib tree
    //moving the file to `dist/es6/backburner.js`
    new Rollup(lib, {
      rollup: {
        entry: 'index.js',
        targets: [{
          dest: 'es6/backburner.js',
          format: 'es',
          exports: 'named'
        }]
      }
    }),
    //grabbing `index.js` within the lib tree
    //moving the file to `dist/tests/backburner.js` into the format amd and `dist/backburner.js`
    new Rollup(libES5, {
      rollup: {
        entry: 'index.js',
        targets: [{
          dest: 'tests/backburner.js',
          format: 'amd',
          moduleId: 'backburner',
          exports: 'named'
        },{
          dest: 'backburner.js',
          format: 'amd',
          exports: 'named'
        }]
      }
    }),
    //./test dir
    //grabbing all test files within rolling them all up into `./dist/tests/tests.js`
    new Rollup(new Funnel('tests', { include: ['**/*.js'], destDir: 'tests' }), {
      rollup: {
        entry: 'tests/index.js',
        external: ['backburner'],
        targets: [{
          dest: 'tests/tests.js',
          format: 'amd',
          moduleId: 'backburner-tests'
        }]
      },
      annotation: 'tests/tests.js'
    }),
    //importing qunit
    //grabbing two files `qunit.css` and `qunit.js`
    //moving both files to `tests` directory
    new Funnel(path.dirname(require.resolve('qunitjs')), {
      annotation: 'tests/qunit.{js,css}',
      files: ['qunit.css', 'qunit.js'],
      destDir: 'tests'
    }),
    //importing loader
    //grabbing `loader.js`
    //moving it to `tests` directory
    new Funnel(path.dirname(require.resolve('loader.js')), {
      annotation: 'tests/loader.js',
      files: ['loader.js'],
      destDir: 'tests'
    }),
    //grabbing `index.html` from `./tests/index.html`
    //moving it to `dist/tests/` directory
    new Funnel(path.join(__dirname, '/tests'), {
      files: ['index.html'],
      destDir: 'tests'
    })
  ], {
    annotation: 'dist'
  });
};
