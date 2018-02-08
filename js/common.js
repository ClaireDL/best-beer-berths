"use strict";

const BEER_DATABASE_FILE = "database.yml"

// Default position when no other position is available
const DEFAULT_POSITION = {lat: 51.5189138, lng: -0.0924759};
const POSITION_UPDATE = 10;

// Cache options
const CACHE_ENABLED = false;
const CACHE_DURATION = 86400;

// Debug options
const DEBUG = true || urlParam("DEBUG") != null;
const DEBUG_CITY = /(london)/i;
const DEBUG_POSITION = {lat: 51.5189138, lng: -0.0924759};
// const DEBUG_POSITION = {lat: 44.0372932, lng: 12.6069268};
// const DEBUG_POSITION = {lat: 51.532492399999995, lng: -0.0351538};

// Pins colours
const PINS = {
  'tried': [ 'FFFFFF', 'FF7FFF' ],
  'to try': [ 'FFFFFF', '007FFF' ]
};


/**
 * Executes an asynchronous action over objects of a queue
 */
function processQueueAsync( inputQueue, outputQueue, action, successValue, successAction, failAction, doneAction ) {
  function execute() {
    if ( inputQueue.length > 0 ) {
      var item = inputQueue[ 0 ];

      // Determine the action to run
      var runAction = action( item );
      if ( !runAction ) {
        doneAction();
        return;
      }

      // Run the action
      runAction( ( item, status ) => {
        Logger.debug( `Timing: delay=${delay.toFixed(3)}ms, dec=${dDec.toFixed(3)}ms` );

        if ( status.match( successValue ) ) {
          // Transfer the item from input to output queue
          var doneItem = inputQueue.shift();
          if ( outputQueue != undefined ) {
            outputQueue.push( doneItem );
          }
          // Tune delay and call callback
          delay -= dDec;
          dDec *= ( 1.0 - 1 / S ) * 0.9;
          if ( successAction ) {
            successAction( doneItem );
          }
          // The delay between requests is self-adjustable
          setTimeout( execute, delay );
        }
        else {
          // Tune delay and call callback
          dDec = delay / S;
          delay *= 2.2;
          if ( failAction ) {
            failAction( item, status );
          }
          // The delay between requests is self-adjustable
          setTimeout( execute, delay );
        }
      });
    }
    else if ( doneAction ) {
      // Call the done action
      doneAction();
    }
  }

  // Set initial values and start
  const S = 2.0; // Steepness
  var delay = 400;
  var dDec = delay / ( S * 2.0 );
  execute();
}


/**
 * Gets a colour from a gradient.
 * See: https://stackoverflow.com/questions/3080421/javascript-colour-gradient
 */
function getGradientColour( start_colour, end_colour, percent ) {
  // Condition the percentage
  percent = Math.max(Math.min(percent, 1.0), 0.0);

  // Strip the leading # if it's there
  var start_colour = start_colour.replace( /^\s*#|\s*$/g, '' );
  var end_colour = end_colour.replace( /^\s*#|\s*$/g, '' );

  // Convert 3 char codes --> 6, e.g. `E0F` --> `EE00FF`
  if( start_colour.length === 3 ) {
    start_colour = start_colour.replace( /(.)/g, '$1$1' );
  }
  if( end_colour.length === 3 ) {
    end_colour = end_colour.replace( /(.)/g, '$1$1' );
  }

  // Convert colours from HEX
  var start_red = parseInt( start_colour.substr(0, 2), 16 );
  var start_green = parseInt( start_colour.substr(2, 2), 16 );
  var start_blue = parseInt( start_colour.substr(4, 2), 16 );

  var end_red = parseInt( end_colour.substr(0, 2), 16 );
  var end_green = parseInt( end_colour.substr(2, 2), 16 );
  var end_blue = parseInt( end_colour.substr(4, 2), 16 );

  // Calculate new colour
  var new_red = ((end_red - start_red) * percent) + start_red;
  var new_green = ((end_green - start_green) * percent) + start_green;
  var new_blue = ((end_blue - start_blue) * percent) + start_blue;

  // Convert back to HEX
  new_red = new_red.toString( 16 ).split( '.' )[0];
  new_green = new_green.toString( 16 ).split( '.' )[0];
  new_blue = new_blue.toString( 16 ).split( '.' )[0];

  // Ensure 2 digits by colour
  if( new_red.length === 1 ) new_red = '0' + new_red;
  if( new_green.length === 1 ) new_green = '0' + new_green;
  if( new_blue.length === 1 ) new_blue = '0' + new_blue;

  return `${new_red}${new_green}${new_blue}`;
}


/**
 * Converts a value into its relative position inside a range using linear
 * interpolation
 */
function rangeRelative( min, value, max ) {
  // Make sure that min < max
  if( min > max ) {
    min = [max, max = min][0];
  }
  var value = Math.max( min, Math.min( max, value ) );
  return (value - min) / (max - min);
}


/**
 * Returns true if we are on a mobile device
 */
function isMobile() {
  try { document.createEvent("TouchEvent"); } catch(e) { return false; }
  return true;
}


/**
 * Create a Google Pin URL
 */
function buildPinUrl(text, fill_colour, scale_factor, font_size) {
  return `http${isSSL() ? 's' : ''}://` +
    "chart.apis.google.com/chart?chst=d_map_pin_letter&" +
    `chld=%E2%80%A2|${fill_colour}`;
  // return `http${isSSL() ? 's' : ''}://` +
  //   "chart.apis.google.com/chart?chst=d_map_spin&" +
  //   `chld=${scale_factor * 0.5}|0|${fill_colour}|${font_size}|_|${text}`;
}


/**
 * Get a URL parameter
 * See https://stackoverflow.com/questions/19491336/get-url-parameter-jquery-or-how-to-get-query-string-values-in-js
 */
function urlParam(name) {
  var searchParams = new URLSearchParams(window.location.search);
  if( !searchParams.has(name) ) {
    return null;
  }
  else {
    return searchParams.get(name);
  }
}


/**
 * Checks if we're under SSL encryption
 */
function isSSL() {
  return document.location.protocol === "https:"
}


/**
 * Helper for debugging
 */
var Logger = (function() {
  var debug;
  var log_level = 4;

  var initDebug = function() {
    if( !debug && $('#debug').length === 0) {
      $('body').append('<div id="debug"></div>');
    }
    debug = $('#debug')[0];
    return debug;
  };

  var setLogLevel = function( value ) {
    log_level = value;
  }

  var getLogLevel = function() {
    return log_level;
  }

  var canLog = function( requested ) {
    if( requested === "log" ) {
      return true;
    } else if( requested === "trace" && log_level >= 4 ) {
      return true;
    } else if( requested === "debug" && log_level >= 3 ) {
      return true;
    } else if( requested === "info" && log_level >= 2 ) {
      return true;
    } else if( requested === "warn" && log_level >= 1 ) {
      return true;
    } else if( requested === "error" && log_level >= 0 ) {
      return true;
    }
    return false;
  }

  var write = function(value, type) {
    if( !canLog(type) ) {
      return;
    }
    var time = $.format.date(new Date(), 'HH:mm:ss.SSS');
    if( DEBUG && isMobile() ) {
      if( initDebug() ) {
        if( typeof(value) === "object" ) {
          console.log( value );
        } else {
          debug.innerHTML = `<span class="${type}">${time}: ${value}</span>` + debug.innerHTML;
        }
      }
    } else {
      if( type === "log" || type === "trace" || type === "debug") {
        console.log(value);
      } else if( type === "info" ) {
        console.info(value);
      } else if( type === "warn" ) {
        console.warn(value);
      } else if( type === "error" ) {
        console.error(value);
      }
    }
  };

  return {
    getLogLevel: getLogLevel,
    setLogLevel: setLogLevel,
    log: function(text) { write(text, "log") },
    trace: function(text) { write(text, "trace") },
    debug: function(text) { write(text, "debug") },
    info: function(text) { write(text, "info") },
    warn: function(text) { write(text, "warn") },
    error: function(text) { write(text, "error") }
  };
})();


/**
 * Function to draw score stars
 */
$.fn.stars = function () {
  return $( this ).each( function () {
    // Read values from HTML and interpret it as JSON
    var json = $.parseJSON( $( this ).html() );

    // Convert the value in pixel size (5 stars, each 16 pixels wide)
    var value = rangeRelative( json.minValue, json.value, json.maxValue );
    var quarterValue = Math.round( value * 4 ) / 4;
    var imageWidth = quarterValue * 5 * 16;

    // Add the stars
    $( this ).html(
      $( '<span />' ).width( imageWidth )
    );
  });
}
