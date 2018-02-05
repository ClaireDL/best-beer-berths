"use strict";

/**
 * Stores of all the Beer Places and some additional information
 */
var PlacesDB = (function() {

  var Cache = (function() {
    /**
     * Loads the cache into the local beer DB
     */
    var load = function() {
      // Check cache enabled
      if( !CACHE_ENABLED ) {
        reset()
        return false;
      }

      Logger.info("Looking for saved cache");

      var cache = window.localStorage.getItem( "BeerPlacesDB" );
      if( cache ) {
        var cache_hash = window.localStorage.getItem( "BeerPlacesDBHash" );
        var cache_timestamp = parseInt( window.localStorage.getItem( "BeerPlacesDBTimestamp" ) || 0 );

        // Check expiry
        var expired = ( new Date().getTime() - cache_timestamp ) >= CACHE_DURATION * 1000;
        if( expired ) {
          Logger.info( `Cache expired.` )
          return false;
        }

        // Check hash
        var hashMatch = dbHash() === cache_hash;
        if( !hashMatch ) {
          Logger.info( `Cache found (${cache_hash}) but doesn't match data (${dbHash()}).` )
          return false;
        }

        // Load
        var places = JSON.parse( cache );

        // Convert the cache into proper BeerPlace objects
        local_db = new Array();
        for( var i in places ) {
          local_db.push(places[i]);
        }

        Logger.info( `Found and loaded cache ${cache_hash}` )
        return true;
      }

      return false;
    };

    /**
     * Saves the DB places into the cache
     */
    var save = function() {
      // Check cache enabled
      if( !CACHE_ENABLED ) {
        reset()
        return false;
      }

      Logger.info( `Saving cache for DB ${dbHash()}` )

      window.localStorage.setItem( "BeerPlacesDB", JSON.stringify(local_db) )
      window.localStorage.setItem( "BeerPlacesDBHash", dbHash() )
      window.localStorage.setItem( "BeerPlacesDBTimestamp", new Date().getTime() )

      return true;
    };

    /**
     * Resets the local cache
     */
    var reset = function() {
      if( CACHE_ENABLED ) {
        window.localStorage.removeItem( "BeerPlacesDB" );
        window.localStorage.removeItem( "BeerPlacesDBHash" );
        window.localStorage.removeItem( "BeerPlacesDBTimestamp" );
        Logger.log( "Cache cleaned" );
      }
      else {
        Logger.log( "The cache is not enabled" );
      }
    };

    return {
      'load': load,
      'save': save,
      'reset': reset
    };
  })();

  var local_db = new Array();

  /**
   * Checks that the raw data for a place is valid, with all the data
   */
  var checkRawData = function( raw_item ) {
    // Check for "Name"
    if( !'Name' in raw_item || !raw_item.Name ) {
      return false;
    }
    // Check for "Address"
    if( !'Address' in raw_item || !raw_item.Address ) {
      return false;
    }
    // Check for "Type"
    if( !'Type' in raw_item || !raw_item.Type ) {
      return false;
    }
    // Check for "Status"
    if( !'Status' in raw_item || !raw_item.Status ) {
      return false;
    }

    if( raw_item.Status.toLowerCase() === "to try" ) {
      // Check for "Expectation"
      if( !'Expectation' in raw_item || !raw_item.Expectation ) {
        return false;
      }
      // Check for "Expectation.Mine"
      if( !'Mine' in raw_item || !raw_item.Expectation.Mine ) {
        return false;
      }
      // Check for "Expectation.Google"
      if( !'Google' in raw_item || !raw_item.Expectation.Google ) {
        return false;
      }
    }

    if( raw_item.Status.toLowerCase() === "tried" ) {
      // Check for "Score"
      if( !'Score' in raw_item || !raw_item.Score ) {
        return false;
      }
    }

    return true;
  };

  /**
   * Scan all the YAML results and build the database
   */
  var parseYaml = function( yaml_data ) {
    var result = new Array();

    for( var country in yaml_data ) {
      var country_cities = yaml_data[country];
      for( var city in country_cities ) {
        var city_places = country_cities[city];
        for( var place in city_places ) {
          var beer_place = city_places[place];
          if( DEBUG && !city.match( DEBUG_CITY ) ) {
            continue;
          }
          // Check the data is valid, if not don't add it
          if( !checkRawData(beer_place) ) {
            Logger.warn(`Missing information on entry ${JSON.stringify(beer_place)}`);
            continue;
          }

          result.push( new BeerPlace(beer_place, country, city) );
        }
      }
    }

    return result.sort();
  };

  /**
   * A fingerprint of the Database data, excluding Google data
   */
  var dbHash = function() {
    var hashes = local_db.map( x => x.dataHash );
    return objectHash.sha1(
      JSON.stringify( hashes )
    );
  };

  /**
   * The highest average amongst all places, given a filter on places
   */
  var maxAvgScore = function( filter_callback = x => true ) {
    return local_db
      .filter( filter_callback )
      .map( x => x.avgScore )
      .reduce( ( x1, x2 ) => Math.max( x1, x2 ), 0.0 );
  };

  /**
   * The lowest average amongst all places, given a filter on places
   */
  var minAvgScore = function( filter_callback = x => true ) {
    return local_db
      .filter( filter_callback )
      .map( x => x.avgScore )
      .reduce( ( x1, x2 ) => Math.min( x1, x2 ), 10.0 );
  };

  /**
   * Loads asynchronously the information about the location of all the places
   */
  var queryForLocations = function() {
    var start_queue = local_db.slice();
    var end_queue = new Array();

    // Stats
    var start = new Date().getTime();
    var queries = 0, failures = 0;
    // Run task
    processQueueAsync(
      start_queue,
      end_queue,
      place => place.queryLocation.bind( place ),
      google.maps.places.PlacesServiceStatus.OK,
      place => {
        addPlaceToMap( place );
        queries++;
      },
      ( place, error ) => {
        Logger.error( `Error querying location for ${place.Name}: ${error}` );
        failures++;
        // In case of ZERO_RESULTS, drop the item
        if( error === google.maps.places.PlacesServiceStatus.ZERO_RESULTS ) {
          var done_item = start_queue.shift();
          Logger.warn( `No results found for ${done_item.name}.` );
          if( end_queue != undefined ) {
            end_queue.push( done_item );
          }
        }
      },
      place => {
        var time = ( new Date().getTime() - start ) / 1000.0;

        Logger.warn( `All locations done: items=${end_queue.length}, queries=${queries}, failures=${failures}, time=${time.toFixed(3)}s.` );
        local_db = end_queue;

        // Run next query
        queryForDetails();
      }
    );
  };

  /**
   * Loads asynchronously the information about the location of all the places
   */
  var queryForDetails = function() {
    var start_queue = local_db.slice();
    var end_queue = new Array();

    // Stats
    var start = new Date().getTime();
    var queries = 0, failures = 0;
    // Run task
    processQueueAsync(
      start_queue,
      end_queue,
      place => place.queryDetails.bind( place ),
      google.maps.places.PlacesServiceStatus.OK,
      place => {
        queries++;
      },
      ( place, error ) => {
        Logger.error( `Error querying details for ${place.Name}: ${error}` );
        failures++;
      },
      place => {
        var time = ( new Date().getTime() - start ) / 1000.0;

        Logger.warn( `All details done: items=${end_queue.length}, queries=${queries}, failures=${failures}, time=${time.toFixed(3)}s.` );
        local_db = end_queue;

        Cache.save()
      }
    );
  };

  /**
   * Requests the addition of a marker on the map
   */
  var addPlaceToMap = function( place ) {
    // Group the colouring by Status
    var filter = x => x.Status.toLowerCase() === place.Status.toLowerCase();
    // Add the pin to the map
    addMarker( place, minAvgScore(filter), maxAvgScore(filter) );
  };

  /**
   * Initializes the DB
   */
  var init = function( raw_data ) {
    // Interpreting YAML data as first thing
    local_db = parseYaml( raw_data );

    // Starts the filling of the Beer Places DB
    if( Cache.load() ) {
      for( var i in local_db ) {
        addPlaceToMap( local_db[i] );
      }
      Cache.save();
    }
    else {
      queryForLocations();
    }
  };

  return {
    'init': init,
    'dbHash': dbHash,
    'maxAvgScore': maxAvgScore,
    'minAvgScore': minAvgScore,
    'Cache': Cache
  };
})();


/**
 * Represents a Beer Place
 */
function BeerPlace( raw_data, country, city ) {

  // The YAML data is assigned as parent level set of members
  Object.assign( this, raw_data );
  this.raw_data = raw_data;
  this.country = country;
  this.city = city;

  /**
   * A fingerprint of the object, calculated with only the YAML data
   */
  this.dataHash = objectHash.sha1( this.raw_data );

  /**
   * The average score of the place
   */
  this.avgScore = (function() {
    // Missing status
    if( !this.Status ) {
      Logger.error( `Missing Status for "${this.Name}"` )
      return 0.0;
    }

    var average = 0.0;
    var count = 0;
    var penalty = 0.0;

    if( this.Status.toLowerCase() === 'tried' ) {
      // Draught score (weight of 33%)
      if( 'Draught' in this.Score ) {
        if( this.Score.Draught > 0.0 ) {
          average += this.Score.Draught * 3.0;
          count += 3;
        }
        else penalty = 0.33;
      }

      // Bottles score (weight of 33%)
      if( 'Bottles' in this.Score ) {
        if( this.Score.Bottles > 0.0 ) {
          average += this.Score.Bottles * 3.0;
          count += 3;
        }
        else penalty = 0.33;
      }

      // Place score (weight of 22%)
      if( 'Place' in this.Score ) {
        if( this.Score.Place > 0.0 ) {
          average += this.Score.Place * 2.0;
          count += 2;
        }
        else penalty = 0.22;
      }

      // Food score (weight of 11%)
      if( 'Food' in this.Score ) {
        if( this.Score.Food > 0.0 ) {
          average += this.Score.Food * 1.0;
          count += 1;
        }
        else penalty = 0.11;
      }

      // Final calculations
      average /= count;
      average -= penalty;
    }
    else if( this.Status.toLowerCase() === 'to try' ) {
      // Personal score (weight of 60%)
      if( 'Mine' in this.Expectation ) {
        average += this.Expectation.Mine * 3.0;
        count += 3;
      }

      // Google score, ranges from 0 to 5 (weight of 40%)
      if( 'Google' in this.Expectation ) {
        average += this.Expectation.Google * 4.0;
        count += 2;
      }

      // Final calculations
      average /= count;
      average -= penalty;
    }

    return average
  }).apply( this );

  /**
   * Queries Google to fetch information about the position and then calls a
   * callback function when the data is available.
   */
  this.queryLocation = function( callback, force = false ) {
    // Merges the location information provided by Google into this object
    function mergeLocation( googleLocation ) {
      var photo_url = ""
      if( googleLocation.photos.length > 0 ) {
        photo_url = googleLocation.photos[0].getUrl({
          'maxHeight': 100,
          'maxWidth': 150,
        });
      }

      this.google_location = {
        place_id: googleLocation.place_id,
        formatted_address: googleLocation.formatted_address,
        geometry: googleLocation.geometry,
        name: googleLocation.name,
        opening_hours: googleLocation.opening_hours,
        open_now: googleLocation.open_now,
        rating: googleLocation.rating,
        photoUrl: photo_url
      };
    }

    // Skip if already present
    if( this.google_location && !force ) {
      Logger.warn( `Location data already loaded for ${this.Name}` );
      return;
    }

    var request = {
      'query': `${this.Name}, ${this.Address}`
    };
    placesService.textSearch( request, ( results, status ) => {
      Logger.info( `Text search completed for "${this.Name}" with status ${status}` );

      if( status === google.maps.places.PlacesServiceStatus.OK ) {
        mergeLocation.call( this, results[0] );
        Logger.info( `Found ID for "${this.Name}": ${this.google_location.place_id}` );
      }

      if( callback ) {
        callback( this, status );
      }
    } );
  }

  /**
   * Queries Google for detaiDeliriumled information about the place and then calls a
   * callback function when the data is available.
   */
  this.queryDetails = function( callback, force = false ) {
    // Merges the details information provided by Google into this object
    function mergeDetails( google_details ) {
      this.google_details = {}
      Object.assign( this.google_details, google_details );
    }

    // Skip if details are missing
    if( !this.google_location ) {
      Logger.error( `Can't load Details because Location is missing for ${this.Name}` );
      return;
    }
    // Skip if already present
    if( this.google_details && !force ) {
      Logger.warn( `Details data already loaded for ${this.Name}` );
      return;
    }

    var request = {
      'placeId': this.google_location.place_id
    };
    placesService.getDetails( request, ( results, status ) => {
      Logger.info( `Details search completed for "${this.Name}" with status ${status}` );

      if( status === google.maps.places.PlacesServiceStatus.OK ) {
        mergeDetails.call( this, results );
        Logger.info( `Found details for "${this.Name}".` );
      }

      if( callback ) {
        callback( this, status );
      }
    });
  }

  /**
   * Build the InfoWindow content for the place
   */
  this.placeInfoWindow = function() {
    // See https://developers.google.com/maps/documentation/urls/guide
    var directions_url = "https://www.google.com/maps/dir/?api=1";
    directions_url += "&destination=" + encodeURI(this.google_location.formatted_address)
    directions_url += "&travelmode=bicycling"      // Options are driving, walking, bicycling or transit

    // Opening hours
    var open_now = "???", open_now_colour = "black";
    if( this.google_details && this.google_details.opening_hours ) {
      if( this.google_details.opening_hours.open_now ) {
        open_now = "Open"; open_now_colour = "green";
      }
      else {
        open_now = "Closed"; open_now_colour = "red";
      }
    }

    // Group the colouring by Status
    var filter = x => x.Status.toLowerCase() === this.Status.toLowerCase();

    // Build and return template
    var hndl_template = Handlebars.compile($('#place-template')[0].innerHTML);
    return hndl_template({
      name:          this.Name,
      type:          this.Type,
      address:       this.google_location.formatted_address,
      avgScore:      this.avgScore.toFixed( 2 ),
      minAvgScore:   PlacesDB.minAvgScore( filter ),
      maxAvgScore:   PlacesDB.maxAvgScore( filter ),
      score:         this.Score || "",
      expectation:   this.Expectation || "",
      imgUrl:        this.google_location.photoUrl || "",
      hasDetails:    'google_details' in this,
      openNow:       open_now,
      openNowColour: open_now_colour,
      website:       this.google_details ? this.google_details.website : "",
      url:           this.google_details ? this.google_details.url : "",
      directionsUrl: directions_url
    });
  }
}
