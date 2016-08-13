var _ = require('lodash');
var colors = require('colors');
var configs = require('./config.json');

module.exports = function (pokeio, myLocation, reinit) {
    var errorCount = 0;
    var originalLocation = JSON.parse(JSON.stringify(myLocation));
    var latitudeDirection = (Math.random() < 0.5 ? 1 : -1);
    var longitudeDirection = (Math.random() < 0.5 ? 1 : -1);


    var logNearbyPokemon = function (nearbyPokemon) {
        var pokemon = pokeio.pokemonlist[parseInt(nearbyPokemon.PokedexNumber) - 1]
    };

    var catchWildPokemons = function (cell, next) {
        function catchInCell(cellIndex, pokeBallType) {
            if(cellIndex >= cell.WildPokemon.length) { next(); return; }
            var wildPokemon = cell.WildPokemon[cellIndex];
            if (checkBlackList(configs.blackList, wildPokemon) === -1) {
                var pokedexInfo = pokeio.pokemonlist[parseInt(wildPokemon.pokemon.PokemonId) - 1];
                console.log('[+] There is a ' + colors.yellow(pokedexInfo.name) + ' near!! I can try to catch it!');

                pokeio.EncounterPokemon(wildPokemon, function (suc, dat) {
                    console.log('Encountering pokemon ' + colors.yellow(pokedexInfo.name) + '...');
                    function performCatch(retry, pokeBallType) {
                        pokeio.CatchPokemon(wildPokemon, 1, 1.950, 1, pokeBallType, function (xsuc, xdat) {
                            var status = ['Unexpected error', colors.green('Successful catch'), colors.red('Catch Escape'), colors.red('Catch Flee'), colors.red('Missed Catch')];
                            if (xdat) {
                                if (xdat.Status === 1) {
                                    console.log('results are in: ', status[xdat.Status]);
                                } else if (retry < 15) {
                                    retry++;
                                    performCatch(retry+1, pokeBallType);
                                    return;
                                } else {
                                    console.log('results are in: ', status[xdat.Status]);
                                }
                            } else if (retry < 5) {
                                retry++;
                                performCatch(retry+1, pokeBallType > 1 ? pokeBallType - 1 : pokeBallType);
                                return;
                            } else {
                                console.log('might have run out of pokeballs: ' + xsuc);
                            }
                            catchInCell(cellIndex + 1, pokeBallType);
                        });
                    }
                    performCatch(0, pokeBallType);
                });
            } else {
                catchInCell(cellIndex + 1, pokeBallType);
            }

        }
        catchInCell(0, Math.floor((Math.random() * 3) + 1)); //1 = pokeballs, 2 = greatballs, 3 = ultraball
    };

    var moveAround = function (location, next) {
        if (configs.moveAround) {
            if (myLocation.coords.latitude > originalLocation.coords.latitude + 0.005) {
                latitudeDirection = -1;
            }
            if (myLocation.coords.latitude < originalLocation.coords.latitude - 0.005) {
                latitudeDirection = 1;
            }
            if (myLocation.coords.longitude > originalLocation.coords.longitude + 0.08) {
                longitudeDirection = -1;
            }
            if (myLocation.coords.longitude < originalLocation.coords.longitude - 0.08) {
                longitudeDirection = 1;
            }
            var direction = (((latitudeDirection > 0) ? "N" : "S") + ((longitudeDirection > 0) ? "E" : "W"));

            if(location) {
                // move to the fort
                myLocation.coords.latitude = location.latitude;
                myLocation.coords.longitude = location.longitude;
                console.log("Moving to out of range fort");
            } else {
                myLocation.coords.latitude += (latitudeDirection * 0.00005);
                myLocation.coords.longitude += (longitudeDirection * 0.00005);
            }
            pokeio.SetLocation(myLocation, function () {
                console.log("I've moved " + direction + " to: loc: " + myLocation.coords.latitude + " " + myLocation.coords.longitude);
                next();
            });
        }
    };

    var checkBlackList = function (blackList, wildPokemon) {
        return _.findIndex(blackList, function (i) {
            return i === wildPokemon.pokemon.PokemonId;
        });
    };

    var releaseDuplicatePokemons = function (next) {
        pokeio.GetInventory(function (err, contents) {
            if (err) {
                console.log('err occurred with getting inventory', err);
                next();
                return;
            }
            var pokemon = _.chain(contents.inventory_delta.inventory_items)
                .filter(function (i) {
                    if (!i.inventory_item_data.pokemon) return false;
                    if (!i.inventory_item_data.pokemon.pokemon_id) return false;
                    return true;
                })
                .map(function (i) {
                    return i.inventory_item_data.pokemon.toRaw();
                })
                .value();

            if(pokemon.length <= 0) { next(); }

            // last step appends
            function releaseAll(allIndex) {
                if(allIndex >= pokemon.length) { next(); return; }
                var pkm = pokemon[allIndex];
                pkm.dupeCount = _.filter(pokemon, {
                    'pokemon_id': pkm.pokemon_id
                });
                if (pkm.dupeCount.length > configs.dupeLimit) {
                    pkm.dupeCount = _.sortBy(pkm.dupeCount, 'cp');

                    function releaseDupe(dupeIndex) {
                        if (dupeIndex >= pkm.dupeCount.length) { releaseAll(allIndex + 1); return; }
                        if (dupeIndex >= pkm.dupeCount.length - configs.dupeLimit) {
                            releaseAll(allIndex + 1);
                        } else {
                            var pok = pkm.dupeCount[dupeIndex];
                            console.log('Got inventory.', pokemon.length, 'pokemon');
                            console.log('Releasing pokemon', pok.pokemon_id, 'with cp ', pok.cp);
                            pokeio.ReleasePokemon(pok.id, function (err, res) {
                                if (err) {
                                    console.log('Error occurred with releasing pokemon:', err);
                                }
                                if (res) {
                                    console.log("Successfully released pokemon:", res);
                                    // Since our inventory list of pokemon has now changed, and we don't know where in the
                                    //  list the change took place, and we're too lazy to write the code to figure it out...
                                    //  Just move on. We'll release more Pokemon in the next tick anyway.
                                    next();
                                    return;
                                }
                                releaseDupe(dupeIndex + 1);
                            });
                        }
                    }
                    releaseDupe(0);
                } else {
                    releaseAll(allIndex + 1);
                }
            }
            releaseAll(0);

        });
    };

    var spinPokestops = function (cell, next) {

        function spinInCell(cellIndex, nextFort) {
            if (cellIndex >= cell.Fort.length) { next(nextFort); return;}
            var fort = cell.Fort[cellIndex],
                distance = Math.sqrt(Math.pow(myLocation.coords.latitude - fort.Latitude, 2) + Math.pow(myLocation.coords.longitude - fort.Longitude, 2));

            if (fort.FortType == 1 && fort.Enabled) {
                if (distance < 0.0004) {
                    pokeio.GetFort(fort.FortId, fort.Latitude, fort.Longitude, function (err, fortresponse) {
                        if (fortresponse) { // 1 = success
                            if (fortresponse.result == 1) { // 1 = success
                                console.log(colors.magenta(fort.FortId) + colors.green(' used!!'));
                            } else {
                                // 2 = out of range ... ignore
                            }
                            spinInCell(cellIndex + 1, nextFort);
                        } else {
                            console.log(colors.magenta(fort.FortId) + colors.red(' error? ') + err);
                            spinInCell(cellIndex + 1, nextFort);
                        }
                    });
                } else if ((Math.random() * 10000) < 15) {
                    nextFort = {
                        latitude: fort.Latitude,
                        longitude: fort.Longitude
                    };
                    spinInCell(cellIndex + 1, nextFort);
                } else {
                    spinInCell(cellIndex + 1, nextFort);
                }
            } else {
                spinInCell(cellIndex+1, nextFort);
            }
        }
        spinInCell(0);
    };

    var botTick = function (err, hb) {
        var start = new Date().getTime();

        function nextTick() {
            var end = new Date().getTime(),
                delay = Math.max(5000 - (end-start), 5000);

            setTimeout(function () {
                pokeio.Heartbeat(botTick);
            }, delay);
        }

        if (err) {
            if(err === "No result") {
                if(errorCount > 10) {
                    console.log('Error threshold exceeded. Logging in again');
                    setTimeout(reinit, 100);
                    return;
                }
                errorCount++;
            }

            console.log('Error on botTick: ', err);
            nextTick();
            return;
        }
        errorCount = 0;

        function deDupe() {
            if (configs.removeDupePokemon) {
                releaseDuplicatePokemons(nextTick);
            } else {
                nextTick();
            }
        }

        function move(nextFort) {
            moveAround(nextFort, deDupe);
        }

        function spinStops(cellIndex, nextFort) {
            if(cellIndex >= hb.cells.length) { move(nextFort); return; }
            spinPokestops(hb.cells[cellIndex], function(nf) { spinStops(cellIndex+1, nextFort || nf); });
        }

        function catchPokemon(cellIndex) {
            if(cellIndex >= hb.cells.length) { spinStops(0); return; }
            catchWildPokemons(hb.cells[cellIndex], function() { catchPokemon(cellIndex+1); });
        }

        // Pokemon ==> GO
        catchPokemon(0);

    };

    return botTick;
};