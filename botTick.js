var _ = require('lodash');
var colors = require('colors');
var configs = require('./config.json');

module.exports = function (pokeio, myLocation) {
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
                                performCatch(retry+1, pokeBallType - 1);
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
        catchInCell(0, 3); //1 = pokeballs, 2 = greatballs, 3 = ultraball
    };

    var moveAround = function (location, next) {
        if (configs.moveAround) {
            if(location) {// && ((Math.random() * 20) < 3)) {
                // move to the fort
                myLocation.coords.latitude = location.latitude;
                myLocation.coords.longitude = location.longitude;
                console.log("Moving to out of range fort");
            } else {
                myLocation.coords.latitude += 0.0001;
                myLocation.coords.longitude += 0.0001;
            }
            pokeio.SetLocation(myLocation, function () {
                console.log("I've moved to: loc: " + myLocation.coords.latitude + " " + myLocation.coords.longitude);
                next();
            });
        }
    };

    var checkBlackList = function (blackList, wildPokemon) {
        return _.findIndex(blackList, function (i) {
            return i === wildPokemon.pokemon.PokemonId;
        });
    };

    var releaseDuplicatePokemons = function () {
        pokeio.GetInventory(function (err, contents) {
            if (err) throw err;
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

            console.log('got inventory, parsing now', pokemon.length, '# of pokemon');

            // last step appends
            _.each(pokemon, function (pkm) {
                pkm.dupeCount = _.filter(pokemon, {
                    'pokemon_id': pkm.pokemon_id
                });
                if (pkm.dupeCount.length > configs.dupeLimit) {
                    pkm.dupeCount = _.sortBy(pkm.dupeCount, 'cp');
                    _.each(pkm.dupeCount, function (pok, index) {
                        if (index >= pkm.dupeCount.length - configs.dupeLimit) {
                            return;
                        } else {
                            console.log('releasing pokem0n', pok.pokemon_id, 'with cp ', pok.cp);
                            pokeio.ReleasePokemon(pok.id, function (err, res) {
                                if (err) {
                                    console.log('err occurred with releasing pokemon', err);
                                }
                                console.log(res);
                            });
                        }
                    });
                }
            });

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
                } else if ((Math.random() * 10000) < 6) {
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
                delay = Math.max(7500 - (end-start), 7500);

            setTimeout(function () {
                pokeio.Heartbeat(botTick);
            }, delay);
        }

        if (err) {
            if(err === "No result") {
                //init();   // TODO: Implement ability to re-login.
            }

            console.log('Error on botTick: ', err);
            nextTick();
            return;
        }

        function deDupe(nextFort) {
            if (configs.removeDupePokemon) {
                releaseDuplicatePokemons();
            }
            moveAround(nextFort, nextTick);
        }

        function spinStops(cellIndex, nextFort1) {
            if(cellIndex >= hb.cells.length) { return; }
            spinPokestops(hb.cells[cellIndex], function(nextFort2) {catchPokemon(cellIndex+1, nextFort2 || nextFort1); });
        }

        function catchPokemon(cellIndex, nextFort) {
            if(cellIndex >= hb.cells.length) { deDupe(nextFort); return; }
            catchWildPokemons(hb.cells[cellIndex], function() { spinStops(cellIndex, nextFort); });
        }
        catchPokemon(0);

    };

    return botTick;
};