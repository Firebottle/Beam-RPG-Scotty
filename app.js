'use strict';

// Requirements
// These are required node modules.
const WebSocket = require('ws');
const JsonDB = require('node-json-db');
const request = require('request');
const auth = require('mixer-shortcode-oauth');
const mixer = require('beam-interactive-node2');
const mixerClient = require('beam-client-node');
const Roll = require('roll'),
    dice = new Roll();


// Database Setup (name / save after each push / human readable format).
// This makes sure these database files exist.
let dbAuth = new JsonDB("db/auth", true, true);
let dbSettings = new JsonDB("db/settings", true, true);
let dbItems = new JsonDB("db/items", true, true);
let dbPlayers = new JsonDB("db/players", true, true);
let dbMonsters = new JsonDB("db/monsters", true, true);
let dbGame = new JsonDB("db/game", true, true);
let dbMissions = new JsonDB("db/missions", true, true);

let socket;

// General Settings
// Basic app variables used with game.
let rpgApp = {
    chanID: dbAuth.getData("/channelID"),
    rpgCommands: "!rpg-inventory, !rpg-daily, !rpg-adventure (cost: " + dbSettings.getData('/adventure/cost') + "), !rpg-training (cost: " + dbSettings.getData('/training/cost') + ") !rpg-arena (bet), !rpg-duel (bet), !rpg-shop, !rpg-shop-refresh (cost: " + dbSettings.getData('/shop-refresh/cost') + "), !rpg-sell",
    raidTimer: dbSettings.getData("/raid/timer"),
    cmdCooldownActive: false,
    raidActive: false,
    raiderList: [],
    weaponListOne: dbItems.getData("/weaponTypeOne"),
    weaponListTwo: dbItems.getData("/weaponTypeTwo"),
    meleeList: dbItems.getData("/meleeWeapon"),
    rangedList: dbItems.getData("/rangedWeapon"),
    magicTypeList: dbItems.getData("/magicType"),
    magicElementsList: dbItems.getData("/elements"),
    magicSpellList: dbItems.getData("/magicSpell"),
    resourceTypeList: dbItems.getData("/resourceType"),
    armorList: dbItems.getData("/armor"),
    potionListOne: dbItems.getData("/potionTypeOne"),
    potionListTwo: dbItems.getData("/potionTypeTwo"),
    potionListThree: dbItems.getData("/potionTypeThree"),
    creatureAttributeList: dbItems.getData("/creatureAttribute"),
    creatureNameList: dbItems.getData("/creatureName"),
    titleTypeList: dbItems.getData("/titleType"),
    titleList: dbItems.getData("/title"),
    companionList: dbItems.getData("/companion"),
    currencyList: dbItems.getData("/currency"),
    trophyList: dbItems.getData("/trophy"),
    training: dbMissions.getData("/training")
};

// Authenticate with Mixer using oauth
// Will print a shortcode out to the terminal
mixer.setWebSocket(require('ws'));
if (typeof dbAuth.getData('/clientId') !== 'string') {
    throw new Error('clientId was not a string');
}
const authInfo = {
    "client_id": dbAuth.getData('/clientId'),
    "scopes": [
        "chat:bypass_slowchat",
        "chat:bypass_links",
        "chat:bypass_filter",
        "chat:bypass_catbot",
        "chat:chat",
        "chat:connect",
        "chat:remove_message",
        "chat:whisper"
    ]
};
const store = new auth.LocalTokenStore(__dirname + '/db/authTokensDoNotShow.json');
const authClient = new auth.ShortcodeAuthClient(authInfo, store);
authClient.on('code', code => {
    console.log(`Go to https://mixer.com/go?code=${code} and enter code ${code}...`);
});

authClient.on('authorized', (token) => {
    console.log('Got token!', token);
    const _instance = new MinimalMixerChatClient({
        authToken: token.access_token
    });
});

authClient.on('expired', () => {
    console.error('Auth request expired');
    process.exit(1);
});

authClient.on('declined', () => {
    console.error('Auth request declined');
    process.exit(1);
});

authClient.on('error', (e) => {
    console.error('Auth error:', e);
    process.exit(1);
});

authClient.doAuth();

//////////////////
// CONNECT TO CHAT

function createChatSocket (userId, channelId, endpoints, authkey) {
    console.log('STARTING createChatSocket');
    socket = new mixerClient.Socket(WebSocket, endpoints).boot();

    // You don't need to wait for the socket to connect before calling
    // methods. We spool them and run them when connected automatically.
    socket.auth(channelId, userId, authkey)
        .then(() => {
            console.log('You are now authenticated!');
            // Send a chat message
            sendBroadcast('Mixer-RPG is now online.');

            // Debug
            //buyPotion('Firebottle', 53078);
            //buyMonster('Firebottle', 53078);
        })
        .catch(error => {
            console.error('Oh no! An error occurred.');
            console.error(error);
        });

    // Listen for chat messages. Note you will also receive your own!
    socket.on('ChatMessage', data => {
        onChatMessage(data);
    });

    // Listen for socket errors. You will need to handle these here.
    socket.on('error', error => {
        console.error('Socket error');
        console.error(error);
    });
}

// Auto and Login
class MinimalMixerChatClient {
    constructor(authJson) {
        let authToken = authJson.authToken;
        let userInfo;
        const client = new mixerClient.Client(new mixerClient.DefaultRequestRunner());

        // With OAuth we don't need to log in. The OAuth Provider will attach
        // the required information to all of our requests after this call.
        client.use(new mixerClient.OAuthProvider(client, {
            tokens: {
                access: authToken,
                expires: Date.now() + (365 * 24 * 60 * 60 * 1000)
            }
        }));

        // Gets the user that the Access Token we provided above belongs to.
        client.request('GET', 'users/current')
            .then(response => {
                // Store the logged in user's details for later reference
                userInfo = response.body;

                // Returns a promise that resolves with our chat connection details.
                return new mixerClient.ChatService(client).join(response.body.channel.id);
            })
            .then(response => {
                const body = response.body;
                return createChatSocket(userInfo.id, userInfo.channel.id, body.endpoints, body.authkey);
            })
            .catch(error => {
                console.error('Something went wrong.');
                console.error(error);
            })
            .then(() => {
                mixerClientOpened();
            });
    }

    mixerClientOpened() {
        console.log('Mixer client opened');

        // Debug, do something every 15 seconds.
        // buyMonster("Firebottle", 53078);
        // rpgAdventure("Firebottle", 53078);

        // CONNECTION OPENED
    }

    MixerChatClientError(error) {
        console.error('interactive error: ', error);
    }
}




///////////////////////////////
// Command Center
///////////////////////////////

function getRawChatMessage(chatEvent) {
    let rawMessage = "";
    chatEvent.message.message.forEach(m => {
        rawMessage += m.text;
    });
    return rawMessage;
}

// Parses a message for commands.
function checkForCommand(chatEvent) {

    // Get raw chat message.
    let normalizedRawMessage = getRawChatMessage(chatEvent).toLowerCase();

    let allCommands = [
        "!rpg",
        "!rpg-equip",
        "!rpg-inventory",
        "!rpg-daily",
        "!rpg-raid",
        "!rpg-arena",
        "!rpg-duel",
        "!rpg-shop",
        "!rpg-shop-refresh",
        "!rpg-training",
        "!rpg-adventure",
        "!rpg-sell",
        "!rpg-potion"
    ];

    for (let command of allCommands) {
        // regex checks if the character after the command is either whitespace or end of string
        // this prevents the "!rpg" command from always returning for all commands
        let regex = new RegExp("^" + command + "(?:\\s|$)");
        if (regex.test(normalizedRawMessage)) {
            console.log('--------------------COMMAND USED-------------------');
            return command;
        }
    }

    return null;
}

// This accepts all scotty responses and determines what to do with them.
function onChatMessage(data) {
    let command = checkForCommand(data);

    if (command == null) {
        return;
    }
    /* Commented out because not used(?!)
    let cmdtype = data.event;
    */

    let username = data['user_name'];
    let userid = data["user_id"];
    let whisper = data.message.meta.whisper;

    let userRoles = data['user_roles'];
    let isStreamer = userRoles.includes("Owner") ? true : false;
    let isMod = userRoles.includes("Mod") || isStreamer ? true : false;
    let rawcommand = getRawChatMessage(data);

    console.log("MixerRPG: " + username + " used command \"" + command + "\".");

    if (dbSettings.getData("/requireWhispers") === true && whisper === true) {
        rpgCommands(username, userid, command, rawcommand, isMod, isStreamer);
    } else if (dbSettings.getData("/requireWhispers") === false) {
        rpgCommands(username, userid, command, rawcommand, isMod, isStreamer);
    } else {
        sendWhisper(username, "Please /whisper " + dbSettings.getData('/botName') + " to run commands.");
    }
}

function rpgCommands(username, userid, command, rawcommand, isMod, isStreamer) {
    // Update player username in player db.
    dbPlayers.push('/' + userid + '/username', username);

    // Commands outside of cooldown.
    if (command === "!rpg") {
        sendWhisper(username, "Want to play? Try these commands: " + rpgApp.rpgCommands + ".");

    } else if (command === "!rpg-equip") {
        dbPlayerKeeper(userid, username);
        dbLastSeen(userid);

    } else if (command === "!rpg-inventory") {
        rpgInventory(username, userid);
        dbLastSeen(userid);

    } else if (command === "!rpg-daily") {
        rpgDailyQuest(username, userid);
        dbLastSeen(userid);

    } else if (command === "!rpg-raid") {
        rpgRaidEvent(username, userid, rawcommand, isMod);
        dbLastSeen(userid);

    } else if (command === "!rpg-arena") {
        rpgCompanionDuel(username, userid, rawcommand);
        dbLastSeen(userid);

    } else if (command === "!rpg-duel") {
        rpgPlayerDuel(username, userid, rawcommand);
        dbLastSeen(userid);

    } else if (command === "!rpg-shop") {
        rpgShopPurchase(username, userid, rawcommand);
        dbLastSeen(userid);

    } else if (command === "!rpg-shop-refresh") {
        rpgRefreshShop(username, userid, isStreamer);
        dbLastSeen(userid);

    } else if (command === "!rpg-training") {
        rpgTraining(username, userid);
        dbLastSeen(userid);

    } else if (command === "!rpg-adventure") {
        rpgAdventure(username, userid);
        dbLastSeen(userid);

    } else if (command === "!rpg-sell") {
        rpgSell(userid);
        dbLastSeen(userid);

    } else if (command === "!rpg-potion") {
        rpgPotion(userid);
        dbLastSeen(userid);
    }
}

//////////////////////
// Helper Functions
//////////////////////

// Whisper
function sendWhisper(username, message) {
    socket.call('whisper', [username, message]);
}

// Chat Broadcast
function sendBroadcast(message) {
    socket.call('msg', [message]);
}

// Add Points
function addPoints(userid, coins) {
    let currentCoins;
    try {
        currentCoins = dbPlayers.getData('/' + userid + '/coins');
    } catch (err) {
        currentCoins = 0;
    }
    dbPlayers.push('/' + userid + '/coins', currentCoins + coins);
}

// Get Points
function getPoints(userid) {
    let currentCoins;
    try {
        currentCoins = dbPlayers.getData('/' + userid + '/coins');
    } catch (err) {
        currentCoins = 0;
    }
    return currentCoins;
}

// Delete Coins
function deletePoints(userid, coins) {
    let currentCoins;
    try {
        currentCoins = dbPlayers.getData('/' + userid + '/coins');
        dbPlayers.push('/' + userid + '/coins', currentCoins - coins);
    } catch (err) {
        currentCoins = 0;
    }
}

// Giveall Coins
function giveallPoints(coins) {
    let users = dbPlayers.getData('/');

    for (let i in users) {
        if (!users.hasOwnProperty(i)) continue;
        addPoints(i, coins);
    }

    sendBroadcast('MixerRPG: Everyone receives ' + coins + ' coins!');
}

/////////////////////////
// Database Manipulation
////////////////////////

// Database Handler - Players Item Holding
// This handles adding an item to the players holding area.
function dbPlayerHolder(userid, dbLocation, itemType, itemName, strength, guile, magic) {
    dbPlayers.push("/" + userid + "/" + dbLocation + "/name", itemName);
    dbPlayers.push("/" + userid + "/" + dbLocation + "/type", itemType);
    dbPlayers.push("/" + userid + "/" + dbLocation + "/strength", strength);
    dbPlayers.push("/" + userid + "/" + dbLocation + "/guile", guile);
    dbPlayers.push("/" + userid + "/" + dbLocation + "/magic", magic);
}

// Database Handler - Last Seen
// This puts a last seen date in player profile when an rpg command is run for use in DB cleanup.
function dbLastSeen(userid) {
    let dateString = new Date();
    let date = dateString.getTime();
    dbPlayers.push("/" + userid + "/lastSeen/lastActive", date);
}

// Database Handler - Cleanup
// This removes players from the database who have no stats, or have a last seen date greater than X days.
// Set timer in settings. If timer is 0 then people will not be deleted.
function dbCleanup() {
    let inactiveTimer = dbSettings.getData("/inactive/timer");
    if (inactiveTimer !== 0) {
        let players = dbPlayers.getData("/");
        let dateString = new Date();
        let date = dateString.getTime();

        console.log('Cleanup started.');

        for (let i in players) {
            if (!players.hasOwnProperty(i)) continue;
            let person = players[i];
            if (person.lastSeen != null && date - person.lastSeen.lastActive >= inactiveTimer) {
                dbPlayers.delete("/" + i);
                console.log('Cleanup removed ' + person.name + ' due to inactivity.');
            }
        }

        console.log('Cleanup finished.');
    }
}
dbCleanup();

// Database Handler - Keep Decision
// This takes whatever item is in holder area of database and equips it to the character.
function dbPlayerKeeper(userid, username) {
    try {
        let item = dbPlayers.getData("/" + userid + "/holding");
        let itemName = item.name;
        let itemType = item.type;
        let strength = item.strength;
        let guile = item.guile;
        let magic = item.magic;
        let location = "equipment";

        // Some items might be equipped in different places, like the backpack of temporary items.
        // Can also set unique settings per item here.
        switch (itemType) {
        case "potion":
            location = "backpack";
            dbPlayers.push("/" + userid + "/" + location + "/" + itemType + "/used", false);
            break;
        default:
            location = "equipment";
        }


        dbPlayers.push("/" + userid + "/" + location + "/" + itemType + "/name", itemName);
        dbPlayers.push("/" + userid + "/" + location + "/" + itemType + "/strength", strength);
        dbPlayers.push("/" + userid + "/" + location + "/" + itemType + "/guile", guile);
        dbPlayers.push("/" + userid + "/" + location + "/" + itemType + "/magic", magic);

        // Rebalance Stats
        characterStats(userid);

        sendWhisper(username, "You equipped: " + itemName + ".");
        dbPlayers.delete("/" + userid + "/holding");
    } catch (error) {
        sendWhisper(username, "You have nothing to equip!");
    }
}

////////////////////
// General / Helper
///////////////////

/* Commented out as not used(?!?!)
// Array Shuffler
// Shuffles an array.
function shuffle(array) {
    let currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {

    // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;

        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }
    return array;
}
*/

// Millisecond to Human Converter
// Convers millisconds into a timestamp people can read.
function msToTime(duration) {
    let hours = Math.floor(duration / 3600000),
        minutes = Math.floor((duration - (hours * 3600000)) / 60000);

    hours = (hours < 10) ? "0" + hours : hours;
    minutes = (minutes < 10) ? "0" + minutes : minutes;

    return hours + " hours and " + minutes + " minutes.";
}

// Array Searcher
// Used in conjunction with item balancer.
function search(nameKey, myArray) {
    for (let i = 0; i < myArray.length; i++) {
        if (myArray[i].name === nameKey) {
            return myArray[i];
        }
    }
}


// Character Stats
// This takes into account all character items and builds out the total character stats.
function characterStats(userid) {
    const player = dbPlayers.getData('/' + userid);
    let totalStrength = 0,
        totalGuile = 0,
        totalMagic = 0,
        strength,
        guile,
        magic;

    // Loop through equipment and add stats together.
    let playerEquipment = player.equipment;
    if (playerEquipment != null) {
        Object.keys(playerEquipment).forEach(function(key) {
            let item = playerEquipment[key];
            totalStrength += item.strength;
            totalGuile += item.guile;
            totalMagic += item.magic;
        });
    }

    // Account for prowess and add that in as well.
    try {
        strength = player.prowess.strength;
    } catch (error) {
        strength = 0;
    }
    try {
        guile = player.prowess.guile;
    } catch (error) {
        guile = 0;
    }
    try {
        magic = player.prowess.magic;
    } catch (error) {
        magic = 0;
    }
    totalStrength = totalStrength + strength;
    totalGuile = totalGuile + guile;
    totalMagic = totalMagic + magic;

    // Push our updated stats back to profile.
    dbPlayers.push("/" + userid + "/stats/strength", totalStrength);
    dbPlayers.push("/" + userid + "/stats/guile", totalGuile);
    dbPlayers.push("/" + userid + "/stats/magic", totalMagic);
}

///////////////////
// ITEM GENERATION
//////////////////

// Monster Generation
function buyMonster(username, userid) {
    let typeOne = dbMonsters.getData("/creatureAttribute");
    let typeTwo = dbMonsters.getData("/monster");

    let typeOneRandom = typeOne[Math.floor(Math.random() * typeOne.length)];
    let typeTwoRandom = typeTwo[Math.floor(Math.random() * typeTwo.length)];
    let monsterName = typeOneRandom + " " + typeTwoRandom;

    let monsterStrength = (dice.roll({
        quantity: 9,
        sides: 6,
        transformations: ['sum']
    })).result;

    let monsterGuile = (dice.roll({
        quantity: 9,
        sides: 6,
        transformations: ['sum']
    })).result;

    let monsterMagic = (dice.roll({
        quantity: 9,
        sides: 6,
        transformations: ['sum']
    })).result;


    // Send to combat.
    let player = {
        userid: userid
    };
    let monster = {
        "name": monsterName,
        "strength": monsterStrength,
        "guile": monsterGuile,
        "magic": monsterMagic
    };

    let combatResults = rpgCombat(player, monster, 1);
    if (combatResults === username) {
        // Add points to user
        let settings = dbSettings.getData('/adventure');
        addPoints(userid, settings["monsterReward"]);
        sendBroadcast(username + " defeated a " + monsterName + ". They looted " + settings["monsterReward"] + " coins.");
    } else {
        // Player lost. Points for the points god!
        sendBroadcast(username + " was defeated by the " + monsterName + "!");
    }
}

// Melee Item Generation
function buyMelee(username, userid, returnItem = false) {
    let randomOne = rpgApp.weaponListOne[Math.floor(Math.random() * rpgApp.weaponListOne.length)];
    let randomTwo = rpgApp.weaponListTwo[Math.floor(Math.random() * rpgApp.weaponListTwo.length)];
    let randomThree = rpgApp.meleeList[Math.floor(Math.random() * rpgApp.meleeList.length)];

    let strengthStat = randomOne.strength + randomTwo.strength + randomThree.strength;
    let guileStat = randomOne.guile + randomTwo.guile + randomThree.guile;
    let magicStat = randomOne.magic + randomTwo.magic + randomThree.magic;
    let itemName = randomOne.name + " " + randomTwo.name + " " + randomThree.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You found a weapon: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "melee", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "melee"};
    }

}

// Ranged Item Generation
function buyRanged(username, userid, returnItem = false) {
    let randomOne = rpgApp.weaponListOne[Math.floor(Math.random() * rpgApp.weaponListOne.length)];
    let randomTwo = rpgApp.weaponListTwo[Math.floor(Math.random() * rpgApp.weaponListTwo.length)];
    let randomThree = rpgApp.rangedList[Math.floor(Math.random() * rpgApp.rangedList.length)];

    let strengthStat = randomOne.strength + randomTwo.strength + randomThree.strength;
    let guileStat = randomOne.guile + randomTwo.guile + randomThree.guile;
    let magicStat = randomOne.magic + randomTwo.magic + randomThree.magic;
    let itemName = randomOne.name + " " + randomTwo.name + " " + randomThree.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You found a ranged weapon: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "ranged", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "ranged"};
    }
}

// Magic Item Generation
function buyMagic(username, userid, returnItem = false) {
    let randomOne = rpgApp.magicTypeList[Math.floor(Math.random() * rpgApp.magicTypeList.length)];
    let randomTwo = rpgApp.magicElementsList[Math.floor(Math.random() * rpgApp.magicElementsList.length)];
    let randomThree = rpgApp.magicSpellList[Math.floor(Math.random() * rpgApp.magicSpellList.length)];

    let strengthStat = randomOne.strength + randomTwo.strength + randomThree.strength;
    let guileStat = randomOne.guile + randomTwo.guile + randomThree.guile;
    let magicStat = randomOne.magic + randomTwo.magic + randomThree.magic;
    let itemName = randomOne.name + " " + randomTwo.name + " " + randomThree.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You learned a spell: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "magic", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "magic"};
    }
}

// armor Item Generation
function buyArmor(username, userid, returnItem = false) {
    let randomOne = rpgApp.weaponListOne[Math.floor(Math.random() * rpgApp.weaponListOne.length)];
    let randomTwo = rpgApp.resourceTypeList[Math.floor(Math.random() * rpgApp.resourceTypeList.length)];
    let randomThree = rpgApp.armorList[Math.floor(Math.random() * rpgApp.armorList.length)];

    let strengthStat = randomOne.strength + randomTwo.strength + randomThree.strength;
    let guileStat = randomOne.guile + randomTwo.guile + randomThree.guile;
    let magicStat = randomOne.magic + randomTwo.magic + randomThree.magic;
    let itemName = randomOne.name + " " + randomTwo.name + " " + randomThree.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You found armor: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "armor", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "armor"};
    }
}

// Mount Item Generation
function buyMount(username, userid, returnItem = false) {
    let randomOne = rpgApp.weaponListOne[Math.floor(Math.random() * rpgApp.weaponListOne.length)];
    let randomTwo = rpgApp.creatureAttributeList[Math.floor(Math.random() * rpgApp.creatureAttributeList.length)];
    let randomThree = rpgApp.creatureNameList[Math.floor(Math.random() * rpgApp.creatureNameList.length)];

    let strengthStat = randomOne.strength + randomTwo.strength + randomThree.strength;
    let guileStat = randomOne.guile + randomTwo.guile + randomThree.guile;
    let magicStat = randomOne.magic + randomTwo.magic + randomThree.magic;
    let itemName = randomOne.name + " " + randomTwo.name + " " + randomThree.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You found a mount: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "mount", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "mount"};
    }
}

// Title Generation
function buyTitle(username, userid, returnItem = false) {
    let randomOne = rpgApp.titleTypeList[Math.floor(Math.random() * rpgApp.titleTypeList.length)];
    let randomTwo = rpgApp.titleList[Math.floor(Math.random() * rpgApp.titleList.length)];

    let strengthStat = randomOne.strength + randomTwo.strength;
    let guileStat = randomOne.guile + randomTwo.guile;
    let magicStat = randomOne.magic + randomTwo.magic;
    let itemName = randomOne.name + " " + randomTwo.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You won a title: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "title", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "title"};
    }
}

// Companion Generation
function buyCompanion(username, userid, returnItem = false) {
    let randomOne = rpgApp.weaponListOne[Math.floor(Math.random() * rpgApp.weaponListOne.length)];
    let randomTwo = rpgApp.creatureAttributeList[Math.floor(Math.random() * rpgApp.creatureAttributeList.length)];
    let randomThree = rpgApp.companionList[Math.floor(Math.random() * rpgApp.companionList.length)];

    let strengthStat = randomOne.strength + randomTwo.strength + randomThree.strength;
    let guileStat = randomOne.guile + randomTwo.guile + randomThree.guile;
    let magicStat = randomOne.magic + randomTwo.magic + randomThree.magic;
    let itemName = randomOne.name + " " + randomTwo.name + " " + randomThree.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You found a companion: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "companion", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "companion"};
    }
}

// Coin Generation
function buyCoins(username, userid) {
    let currency = dbItems.getData("/currency");
    let coins = currency[Math.floor(Math.random() * currency.length)];

    // Push info to queue
    console.log('MixerRPG: ' + username + ' got ' + coins + ' coins.');
    sendWhisper(username, "You found " + coins + " coins!");

    // Add points to user in scottybot
    addPoints(userid, coins);
}

// Trophy Generation
function buyTrophy(username, streamerName, userid, returnItem = false) {
    let randomTwo = rpgApp.trophyList[Math.floor(Math.random() * rpgApp.trophyList.length)];

    let strengthStat = randomTwo.strength;
    let guileStat = randomTwo.guile;
    let magicStat = randomTwo.magic;
    let itemName = streamerName + "'s " + randomTwo.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You found a trophy: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "trophy", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "trophy"};
    }
}

// Potion
function buyPotion(username, userid, returnItem = false) {
    let randomOne = rpgApp.potionListOne[Math.floor(Math.random() * rpgApp.potionListOne.length)];
    let randomTwo = rpgApp.potionListTwo[Math.floor(Math.random() * rpgApp.potionListTwo.length)];
    let randomThree = rpgApp.potionListThree[Math.floor(Math.random() * rpgApp.potionListThree.length)];

    let strengthStat = randomOne.strength + randomTwo.strength + randomThree.strength;
    let guileStat = randomOne.guile + randomTwo.guile + randomThree.guile;
    let magicStat = randomOne.magic + randomTwo.magic + randomThree.magic;
    let itemName = randomOne.name + " " + randomTwo.name + " " + randomThree.name;

    // Push info to queue
    if (returnItem === false) {
        console.log('MixerRPG: ' + username + ' got a ' + itemName + ' (' + strengthStat + '/' + guileStat + '/' + magicStat + ').');
        sendWhisper(username, "You found a potion: " + itemName + " (" + strengthStat + "/" + guileStat + "/" + magicStat + "). Type !rpg-equip to use it or !rpg-sell to sell it.");

        // Push to DB
        dbPlayerHolder(userid, "holding", "potion", itemName, strengthStat, guileStat, magicStat);
    } else {
        return {"name": itemName, "strength": strengthStat, "guile": guileStat, "magic": magicStat, "itemslot": "potion"};
    }
}

// RPG Inventory
// Prints out a players inventory.
function rpgInventory(username, userid) {

    // Recalc total.
    characterStats(userid);

    let title,
        titleStats,
        melee,
        meleeStats,
        ranged,
        rangedStats,
        magicName,
        magicStats,
        armor,
        armorStats,
        mount,
        mountStats,
        companion,
        companionStats,
        trophy,
        trophyStats,
        potionName,
        potionStats,
        prowessStrength,
        prowessGuile,
        prowessMagic,
        charStats,
        coins;

    try {
        let strength = dbPlayers.getData("/" + userid + "/equipment/title/strength");
        let guile = dbPlayers.getData("/" + userid + "/equipment/title/guile");
        let magic = dbPlayers.getData("/" + userid + "/equipment/title/magic");

        title = dbPlayers.getData("/" + userid + "/equipment/title/name");
        titleStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (error) {
        title = "Commoner";
        titleStats = "(0/0/0)";
    }
    try {
        let strength = dbPlayers.getData("/" + userid + "/equipment/melee/strength");
        let guile = dbPlayers.getData("/" + userid + "/equipment/melee/guile");
        let magic = dbPlayers.getData("/" + userid + "/equipment/melee/magic");

        melee = dbPlayers.getData("/" + userid + "/equipment/melee/name");
        meleeStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (error) {
        melee = "Fists";
        meleeStats = "(0/0/0)";
    }
    try {
        let strength = dbPlayers.getData("/" + userid + "/equipment/ranged/strength");
        let guile = dbPlayers.getData("/" + userid + "/equipment/ranged/guile");
        let magic = dbPlayers.getData("/" + userid + "/equipment/ranged/magic");

        ranged = dbPlayers.getData("/" + userid + "/equipment/ranged/name");
        rangedStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (error) {
        ranged = "Nothing";
        rangedStats = "(0/0/0)";
    }
    try {
        let strength = dbPlayers.getData("/" + userid + "/equipment/magic/strength");
        let guile = dbPlayers.getData("/" + userid + "/equipment/magic/guile");
        let magic = dbPlayers.getData("/" + userid + "/equipment/magic/magic");

        magicName = dbPlayers.getData("/" + userid + "/equipment/magic/name");
        magicStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (error) {
        magicName = "Nothing";
        magicStats = "(0/0/0)";
    }
    try {
        let strength = dbPlayers.getData("/" + userid + "/equipment/armor/strength");
        let guile = dbPlayers.getData("/" + userid + "/equipment/armor/guile");
        let magic = dbPlayers.getData("/" + userid + "/equipment/armor/magic");

        armor = dbPlayers.getData("/" + userid + "/equipment/armor/name");
        armorStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (ignore) {
        armor = "Naked";
        armorStats = "(0/0/0)";
    }
    try {
        let strength = dbPlayers.getData("/" + userid + "/equipment/mount/strength");
        let guile = dbPlayers.getData("/" + userid + "/equipment/mount/guile");
        let magic = dbPlayers.getData("/" + userid + "/equipment/mount/magic");

        mount = dbPlayers.getData("/" + userid + "/equipment/mount/name");
        mountStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (error) {
        mount = "Nothing";
        mountStats = "(0/0/0)";
    }
    try {
        let strength = dbPlayers.getData("/" + userid + "/equipment/companion/strength");
        let guile = dbPlayers.getData("/" + userid + "/equipment/companion/guile");
        let magic = dbPlayers.getData("/" + userid + "/equipment/companion/magic");

        companion = dbPlayers.getData("/" + userid + "/equipment/companion/name");
        companionStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (error) {
        companion = "None";
        companionStats = "(0/0/0)";
    }
    try {
        let strength = dbPlayers.getData("/" + userid + "/equipment/trophy/strength");
        let guile = dbPlayers.getData("/" + userid + "/equipment/trophy/guile");
        let magic = dbPlayers.getData("/" + userid + "/equipment/trophy/magic");

        trophy = dbPlayers.getData("/" + userid + "/equipment/trophy/name");
        trophyStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (error) {
        trophy = "None";
        trophyStats = "(0/0/0)";
    }


    try {
        let strength = dbPlayers.getData("/" + userid + "/backpack/potion/strength");
        let guile = dbPlayers.getData("/" + userid + "/backpack/potion/guile");
        let magic = dbPlayers.getData("/" + userid + "/backpack/potion/magic");
        let potion = dbPlayers.getData("/" + userid + "/backpack/potion/name");
        let potionUsed = dbPlayers.getData("/" + userid + "/backpack/potion/used") ? "Active" : "Inactive";

        potionName = potion + " : " + potionUsed;
        potionStats = "(" + strength + "/" + guile + "/" + magic + ")";
    } catch (error) {
        console.log(error);
        potionName = "None";
        potionStats = "(0/0/0)";
    }

    try {
        prowessStrength = dbPlayers.getData("/" + userid + "/prowess/strength");
    } catch (error) {
        prowessStrength = 0;
    }
    try {
        prowessGuile = dbPlayers.getData("/" + userid + "/prowess/guile");
    } catch (error) {
        prowessGuile = 0;
    }
    try {
        prowessMagic = dbPlayers.getData("/" + userid + "/prowess/magic");
    } catch (error) {
        prowessMagic = 0;
    }
    let prowessStats = "(" + prowessStrength + "/" + prowessGuile + "/" + prowessMagic + ")";

    try {
        let strength = dbPlayers.getData("/" + userid + "/stats/strength");
        let guile = dbPlayers.getData("/" + userid + "/stats/guile");
        let magic = dbPlayers.getData("/" + userid + "/stats/magic");
        charStats = "(S: " + strength + "/G: " + guile + "/M: " + magic + ")";
    } catch (error) {
        charStats = "Error";
    }

    try {
        coins = dbPlayers.getData("/" + userid + "/coins");
    } catch (err) {
        coins = "0";
    }

    let sayInventory1 = username + " the " + title + " " + titleStats + " || Coins: " + coins + " || Melee: " + melee + " " + meleeStats + " || Ranged: " + ranged + " " + rangedStats + " || Magic: " + magicName + " " + magicStats + " || Armor: " + armor + " " + armorStats;
    let sayInventory2 = "Mount: " + mount + " " + mountStats + " || Companion: " + companion + " " + companionStats + " || Trophy: " + trophy + " " + trophyStats + " || Potion: " + potionName + " " + potionStats + " || Prowess: " + prowessStats + " || Total: " + charStats;
    sendWhisper(username, sayInventory1);
    sendWhisper(username, sayInventory2);
}

///////////////////////////
// QUESTS, ADVENTURES, ETC
//////////////////////////

// RPG Combat
// This handles combat in the game.
function rpgCombat(userOne, userTwo, diceToRoll) {
    let round = 0;
    let personOneWin = 0;
    let personTwoWin = 0;

    let personOne = userOne || {};
    let personTwo = userTwo || {};

    let personOneName,
        personOneStrength,
        personOneGuile,
        personOneMagic,
        personOneRoll,
        personTwoName,
        personTwoStrength,
        personTwoGuile,
        personTwoMagic,
        personTwoRoll;

    let result;

    // Get person one stats.
    if (personOne.userid == null) {
        // No user id provided, get stats from combat packet sent over.
        personOneName = personOne.name;
        personOneStrength = personOne.strength || 0;
        personOneGuile = personOne.guile || 0;
        personOneMagic = personOne.magic || 0;

    } else {
        // User id provided, get stats for character.
        let userid = personOne.userid;
        personOneName = dbPlayers.getData('/' + userid + '/username');
        switch (personOne.type) {
        case "companion":
            personOneName = dbPlayers.getData('/' + userid + '/equipment/companion/name');
            personOneStrength = dbPlayers.getData('/' + userid + '/equipment/companion/strength') || 0;
            personOneGuile = dbPlayers.getData('/' + userid + '/equipment/companion/guile') || 0;
            personOneMagic = dbPlayers.getData('/' + userid + '/equipment/companion/magic') || 0;
            break;

        default:
            personOneName = dbPlayers.getData('/' + userid + '/username');
            personOneStrength = dbPlayers.getData('/' + userid + '/stats/strength') || 0;
            personOneGuile = dbPlayers.getData('/' + userid + '/stats/guile') || 0;
            personOneMagic = dbPlayers.getData('/' + userid + '/stats/magic') || 0;
        }

        // Use potion if they've drank it before this fight, then remove it from inventory.
        try {
            let personOnePotion = dbPlayers.getData('/' + userid + '/backpack/potion');
            if (personOnePotion.used === true) {
                personOneStrength = personOneStrength + personOnePotion.strength;
                personOneGuile = personOneGuile + personOnePotion.guile;
                personOneMagic = personOneMagic + personOnePotion.magic;
                dbPlayers.delete('/' + userid + '/backpack/potion');
            }
        } catch (ignore) {} //eslint-disable-line no-empty
    }

    // Get person one stats.
    if (personTwo.userid == null) {
        // No user id provided, get stats from combat packet sent over.
        personTwoName = personTwo.name;
        personTwoStrength = personTwo.strength;
        personTwoGuile = personTwo.guile;
        personTwoMagic = personTwo.magic;
    } else {
        // User id provided, get stats for character.
        let userid = personTwo.userid;
        personTwoName = dbPlayers.getData('/' + userid + '/username');
        switch (personTwo.type) {
        case "companion":
            personTwoName = dbPlayers.getData('/' + userid + '/equipment/companion/name');
            personTwoStrength = dbPlayers.getData('/' + userid + '/equipment/companion/strength');
            personTwoGuile = dbPlayers.getData('/' + userid + '/equipment/companion/guile');
            personTwoMagic = dbPlayers.getData('/' + userid + '/equipment/companion/magic');
            break;
        default:
            personTwoName = dbPlayers.getData('/' + userid + '/username');
            personTwoStrength = dbPlayers.getData('/' + userid + '/stats/strength');
            personTwoGuile = dbPlayers.getData('/' + userid + '/stats/guile');
            personTwoMagic = dbPlayers.getData('/' + userid + '/stats/magic');
        }

        // Use potion if they've drank it before this fight, then remove it from inventory.
        try {
            let personOnePotion = dbPlayers.getData('/' + userid + '/backpack/potion');
            if (personOnePotion.used === true) {
                personOneStrength = personOneStrength + personOnePotion.strength;
                personOneGuile = personOneGuile + personOnePotion.guile;
                personOneMagic = personOneMagic + personOnePotion.magic;
                dbPlayers.delete('/' + userid + '/backpack/potion');
            }
        } catch (ignore) { } //eslint-disable-line no-empty
    }

    while (round < 3) {

        // Pick stat to face off with.
        let statPicker = (dice.roll('d3')).result;
        if (statPicker === 1) {

            //Strength
            personOneRoll = (dice.roll({
                quantity: diceToRoll,
                sides: 6,
                transformations: ['sum']
            })).result;
            personOneRoll += personOneStrength;

            personTwoRoll = (dice.roll({
                quantity: diceToRoll,
                sides: 6,
                transformations: ['sum']
            })).result;
            personTwoRoll += personTwoStrength;

            console.log('Strength: ' + personOneRoll + ' vs ' + personTwoRoll);

            if (personOneRoll >= personTwoRoll) {
                personOneWin = personOneWin + 1;
            } else {
                personTwoWin = personTwoWin + 1;
            }
        } else if (statPicker === 2) {

            //Guile
            personOneRoll = (dice.roll({
                quantity: diceToRoll,
                sides: 6,
                transformations: ['sum']
            })).result;
            personOneRoll += personOneGuile;


            personTwoRoll = (dice.roll({
                quantity: diceToRoll,
                sides: 6,
                transformations: ['sum']
            })).result;
            personTwoRoll += personTwoGuile;

            console.log('Guile: ' + personOneRoll + ' vs ' + personTwoRoll);

            if (personOneRoll >= personTwoRoll) {
                personOneWin = personOneWin + 1;
            } else {
                personTwoWin = personTwoWin + 1;
            }
        } else {

            //Magic
            personOneRoll = (dice.roll({
                quantity: diceToRoll,
                sides: 6,
                transformations: ['sum']
            })).result;
            personOneRoll += personOneMagic;

            personTwoRoll = (dice.roll({
                quantity: diceToRoll,
                sides: 6,
                transformations: ['sum']
            })).result;
            personTwoRoll += personTwoMagic;

            console.log('Magic: ' + personOneRoll + ' vs ' + personTwoRoll);

            if (personOneRoll >= personTwoRoll) {
                personOneWin = personOneWin + 1;
            } else {
                personTwoWin = personTwoWin + 1;
            }
        }

        // Go to next round.
        round = round + 1;
    }

    console.log('Combat Results: ' + personOneName + ': ' + personOneWin + ' vs ' + personTwoName + ': ' + personTwoWin);

    // Send whisper to player one if they're a person.
    if (personOne.userid != null) {
        sendWhisper(personOneName, "Combat Results: " + personOneName + " (" + personOneStrength + "/" + personOneGuile + "/" + personOneMagic + ") won " + personOneWin + " times. vs " + personTwoName + " (" + personTwoStrength + "/" + personTwoGuile + "/" + personTwoMagic + ") won " + personTwoWin + " times.");
    }

    // Send whisper to player two if they're a person.
    if (personTwo.userid != null) {
        sendWhisper(personTwoName, "Combat Results: " + personOneName + " (" + personOneStrength + "/" + personOneGuile + "/" + personOneMagic + ") won " + personOneWin + " times. vs " + personTwoName + " (" + personTwoStrength + "/" + personTwoGuile + "/" + personTwoMagic + ") won " + personTwoWin + " times.");
    }

    // Return battle results to main functions for payouts, etc...
    if (personOneWin > personTwoWin) {
        result = personOneName;
    } else {
        result = personTwoName;
    }

    return result;
}

// RPG Adventure
// This sends the character on an adventure where they get a random piece of loot.
// Rolls a d20 to determine what happens.
function rpgAdventure(username, userid) {
    let settings = dbSettings.getData('/adventure');
    let currentCoins = getPoints(userid);

    if (settings.active === true && currentCoins >= settings.cost) {
        let diceRoll = Math.floor((Math.random() * 20) + 1);

        if (diceRoll === 1) {
            // Mimic!
            buyMonster(username, userid);
        } else if (diceRoll >= 2 && diceRoll <= 4) {
            // Melee
            buyMelee(username, userid);
        } else if (diceRoll >= 5 && diceRoll <= 7) {
            // Ranged
            buyRanged(username, userid);
        } else if (diceRoll >= 8 && diceRoll <= 11) {
            // Magic Spell
            buyMagic(username, userid);
        } else if (diceRoll >= 12 && diceRoll <= 13) {
            // armor
            buyArmor(username, userid);
        } else if (diceRoll >= 14 && diceRoll <= 15) {
            // Mount
            buyMount(username, userid);
        } else if (diceRoll === 16) {
            //Title
            buyTitle(username, userid);
        } else if (diceRoll === 17) {
            //Companion
            buyCompanion(username, userid);
        } else if (diceRoll === 18 || diceRoll === 19) {
            //Potion
            buyPotion(username, userid);
        } else {
            //Coins
            buyCoins(username, userid);
        }

        deletePoints(userid, settings.cost);
    } else {
        sendWhisper(username, 'You do not have enough coins for this, or adventure is deactivated.');
    }
}

// RPG Daily Quest
// This is a simply daily that people can trigger once every 24 hours to get a coin boost.
function rpgDailyQuest(username, userid) {
    let dailyReward = dbSettings.getData("/dailyReward");
    let lastDaily;
    try {
        lastDaily = dbPlayers.getData("/" + userid + "/lastSeen/dailyQuest");
    } catch (error) {
        lastDaily = 1;
    }
    let date = new Date().getTime();
    let timeSinceLastDaily = date - lastDaily;
    let timeUntilNext = 86400000 - timeSinceLastDaily;
    let humanTime = msToTime(timeUntilNext);

    if (timeSinceLastDaily >= 86400000) {
        dbPlayers.push("/" + userid + "/lastSeen/dailyQuest", date);
        addPoints(userid, dailyReward);
        sendWhisper(username, "Daily completed! Reward: " + dailyReward + " || Cooldown: 24hr");
    } else {
        sendWhisper(username, "You already completed your daily! Try again in " + humanTime + ".");
    }
}

// RPG Raid Event
// This will start a raid and use the target streamer as a boss. Meant to be used once at the end of a stream.
function rpgRaidEvent(username, userid, rawcommand, isMod) {
    let raidCommandArray = (rawcommand).split(" ");
    let raidTarget = raidCommandArray[1];

    if (isMod === true && rpgApp.raidActive === false && raidTarget !== undefined) {

        // Get target info and start up the raid.
        request('https://mixer.com/api/v1/channels/' + raidTarget, function(error, response) {
            if (!error && response.statusCode === 200) {

                // Great, valid raid target. Get target info, set raid to active, send broadcast to overlay with info.
                sendBroadcast(username + " has started a raid! Type !rpg-raid to join!");
                rpgApp.raidActive = true;

                // Start timer for raid event based on setting in settings db.
                setTimeout(function() {

                    let diceRoller = (dice.roll({
                        quantity: 1,
                        sides: 20,
                        transformations: ['sum']
                    })).result;

                    if (diceRoller <= 8) {
                        let luckyPerson = rpgApp.raiderList[Math.floor(Math.random() * rpgApp.raiderList.length)];
                        let luckyPersonName = luckyPerson.name;
                        buyTrophy(luckyPersonName, raidTarget, luckyPerson.userid);
                        let raidWinCoin = dbSettings.getData("/raid/winReward");
                        giveallPoints(raidWinCoin);
                        sendBroadcast("The raid has ended. The horde has overcome " + raidTarget + " and " + luckyPersonName + " took a trophy. Everyone also gets " + raidWinCoin + " coins!");
                        sendWhisper(luckyPersonName, "You got a trophy! Type !rpg-equip to use it!");
                    } else {
                        let raidLoseCoin = dbSettings.getData("/raid/loseReward");
                        giveallPoints(raidLoseCoin);
                        sendBroadcast("The raid has ended. " + raidTarget + " has fought off the horde. Everyone gets " + raidLoseCoin + " coins for your repair bill.");
                    }

                    // Get raid message and send that to chat when everything is over.
                    let raidMessage = dbSettings.getData("/raid/raidMessage");
                    sendBroadcast(raidMessage + " || https://mixer.com/" + raidTarget);

                    // Reset lists and flags
                    rpgApp.raidActive = false;
                    rpgApp.raiderList = [];

                }, rpgApp.raidTimer);

            } else {
                sendWhisper(username, "Error: " + raidTarget + " is not a valid raid target!");
            }
        });

    } else if (rpgApp.raidActive === true) {
        // Raid is active. Add user to raid participant list if they're not already there.
        let raiderName = search(username, rpgApp.raiderList);
        if (raiderName === undefined) {
            rpgApp.raiderList.push({
                "name": username,
                "userid": userid
            });
            sendWhisper(username, "You've joined the raid!");
        } else {
            sendWhisper(username, "You've already joined the raid!");
        }
    } else {
        // No raid is active
        sendWhisper(username, "There is currently not an active raid.");
    }
}

// RPG Companion Duel
// This allows users to battle companions for coins.
function rpgCompanionDuel(username, userid, rawcommand) {

    // Stop if duels are off.
    let isAllowed = dbSettings.getData("/companionDuel/active");
    if (!isAllowed) {
        sendWhisper(username, "This command is currently deactivated.");
        return;
    }

    let inProgress,
        expire;

    // See if we have a duel in progress.
    try {
        inProgress = dbGame.getData("/companionDuel/settings/inProgress");
    } catch (err) {
        inProgress = false;
    }

    // Check to see if the old duel has expired yet.
    try {
        expire = dbGame.getData("/companionDuel/settings/expireTime");
    } catch (err) {
        expire = new Date().getTime();
    }
    let expireCheck = new Date().getTime() - expire;
    if (expireCheck >= 30000) {
        // It expired, clear everything.
        dbGame.delete("/companionDuel");
        inProgress = false;
        dbGame.push('/companionDuel/settings/inProgress', false);
    }

    let commandArray = (rawcommand).split(" ");
    let pointsBet = !inProgress ? parseInt(commandArray[1]) : dbGame.getData("/companionDuel/settings/amount");
    let minimumBet = dbSettings.getData("/companionDuel/minBet");

    // If this happens it means no duel is running and the person tried !rpg BLAHBLAH (without numbers for a bet)
    if (!inProgress && isNaN(pointsBet)) {
        sendWhisper(username, "Please use numbers when trying to place a bet.");
        return;
    }

    // Make sure the bet is over the minimum.
    if (pointsBet < minimumBet) {
        sendWhisper(username, "The minimum bet is: " + minimumBet);
        return;
    }

    // Okay, initial checks passed!
    // If there is a duel in progress...
    if (inProgress) {
        // Duel in progress!
        let currentPoints = getPoints(userid);

        // Stop here if the user doesnt have enough money to cover the bet.
        if (currentPoints < pointsBet) {
            sendWhisper(username, "You don't have enough money to enter this duel.");
            return;
        }

        // BATTLE TIME
        // Get player data.
        let playerOne = dbGame.getData("/companionDuel/playerOne");
        let playerTwoProfile = dbPlayers.getData('/' + userid);

        // Only let people will companions enter the battle.
        if (playerTwoProfile.equipment.companion == null) {
            sendWhisper(username, "You need a companion to enter an arena battle!");
            return;
        }

        // Take number of points that were bet.
        deletePoints(playerOne, pointsBet);
        deletePoints(userid, pointsBet);

        // Send info to combat function.
        let playerOneCombat = {
            type: "companion",
            userid: playerOne
        };
        let playerTwoCombat = {
            type: "companion",
            userid: userid
        };

        // Get Results can calulate winnings.
        let combatResults = rpgCombat(playerOneCombat, playerTwoCombat, 1);
        let winnings = pointsBet * 2;

        // Give the pot to whoever won.
        console.log('Arena Winner: ' + combatResults + ' || Amount:' + winnings);

        // Give points to whoever won.
        if (combatResults === username) {
            // Player two (person running command).
            addPoints(userid, winnings);
        } else {
            // Player one
            addPoints(playerOne, winnings);
        }

        sendBroadcast(combatResults + ' has won the arena battle! Their team wins ' + winnings + ' coins.');

        // Reset Game
        dbGame.delete("/companionDuel");
    } else {
        // Duel not in progress!
        let playerProfile = dbPlayers.getData('/' + userid);

        // Only let people will companions enter the battle.
        if (playerProfile.equipment.companion === null || playerProfile.equipment.companion === undefined) {
            sendWhisper(username, "You need a companion to start an arena battle!");
            return;
        }

        // Stop here if person doesnt have enough coins.
        if (playerProfile.coins < pointsBet) {
            sendWhisper(username, "You do not have enough coins for this battle.");
            return;
        }

        dbGame.push("/companionDuel/playerOne", userid);
        dbGame.push("/companionDuel/settings/amount", pointsBet);
        dbGame.push("/companionDuel/settings/expireTime", new Date().getTime());
        dbGame.push("/companionDuel/settings/inProgress", true);

        // Broadcast that a duelist is waiting for a challenger.
        sendBroadcast(playerProfile.username + " has bet " + pointsBet + " coins on a companion battle. Type !rpg-arena to accept the challenge. Expires: 30 sec.");
    }
}

// RPG Player Duel
// This allows users to battle each other.
function rpgPlayerDuel(username, userid, rawcommand) {

    // Stop if duels are off.
    let isAllowed = dbSettings.getData("/playerDuel/active");
    if (!isAllowed) {
        sendWhisper(username, "This command is currently deactivated.");
        return;
    }

    let inProgress,
        expire;

    // See if we have a duel in progress.
    try {
        inProgress = dbGame.getData("/playerDuel/settings/inProgress");
    } catch (err) {
        inProgress = false;
    }

    // Check to see if the old duel has expired yet.
    try {
        expire = dbGame.getData("/playerDuel/settings/expireTime");
    } catch (err) {
        expire = new Date().getTime();
    }
    let expireCheck = new Date().getTime() - expire;
    if (expireCheck >= 30000) {
        // It expired, clear everything.
        dbGame.delete("/playerDuel");
        inProgress = false;
        dbGame.push('/playerDuel/settings/inProgress', false);
    }

    let commandArray = (rawcommand).split(" ");
    let pointsBet = !inProgress ? parseInt(commandArray[1]) : dbGame.getData("/playerDuel/settings/amount");
    let minimumBet = dbSettings.getData("/playerDuel/minBet");

    // If this happens it means no duel is running and the person tried !rpg BLAHBLAH (without numbers for a bet)
    if (!inProgress && isNaN(pointsBet)) {
        sendWhisper(username, "Please use numbers when trying to place a bet.");
        return;
    }

    // Make sure the bet is over the minimum.
    if (pointsBet < minimumBet) {
        sendWhisper(username, "The minimum bet is: " + minimumBet);
        return;
    }

    // Okay, initial checks passed!
    // If there is a duel in progress...
    if (inProgress) {
        // Duel in progress!
        let currentPoints = getPoints(userid);

        // Stop here if the user doesnt have enough money to cover the bet.
        if (currentPoints < pointsBet) {
            sendWhisper(username, "You don't have enough money to enter this duel.");
            return;
        }

        // BATTLE TIME
        // Get player data.
        let playerOne = dbGame.getData("/playerDuel/playerOne");

        // Take number of points that were bet.
        deletePoints(playerOne, pointsBet);
        deletePoints(userid, pointsBet);

        // Send info to combat function.
        let playerOneCombat = {
            userid: playerOne
        };
        let playerTwoCombat = {
            userid: userid
        };

        // Get Results can calulate winnings.
        let combatResults = rpgCombat(playerOneCombat, playerTwoCombat, 1);
        let winnings = pointsBet * 2;

        // Give the pot to whoever won.
        console.log('Arena Winner: ' + combatResults + ' || Amount:' + winnings);

        // Give points to whoever won.
        if (combatResults === username) {
            // Player two (person running command).
            addPoints(userid, winnings);
        } else {
            // Player one
            addPoints(playerOne, winnings);
        }

        sendBroadcast(combatResults + ' has won the duel! They win ' + winnings + ' coins.');

        // Reset Game
        dbGame.delete("/playerDuel");
    } else {
        // Duel not in progress!
        let playerProfile = dbPlayers.getData('/' + userid);

        // Stop here if person doesnt have enough coins.
        if (playerProfile.coins < pointsBet) {
            sendWhisper(username, "You do not have enough coins for this battle.");
            return;
        }

        dbGame.push("/playerDuel/playerOne", userid);
        dbGame.push("/playerDuel/settings/amount", pointsBet);
        dbGame.push("/playerDuel/settings/expireTime", new Date().getTime());
        dbGame.push("/playerDuel/settings/inProgress", true);

        // Broadcast that a duelist is waiting for a challenger.
        sendBroadcast(playerProfile.username + " has bet " + pointsBet + " coins on a duel. Type !rpg-duel to accept the challenge. Expires: 30 sec.");
    }
}

// Shop Item Generation
// This generates items in the shop.
function rpgRefreshShop(username, userid, isStreamer) {
    let settings = dbSettings.getData('/shop-refresh');
    let currentCoins = getPoints(userid);
    if (currentCoins >= settings.cost || isStreamer && settings.active === true) {
        request(`https://mixer.com/api/v1/chats/${rpgApp.chanID}/users`, function(error, response, body) {
            if (!error && response.statusCode === 200) {
                let data = JSON.parse(body);
                let user = data[Math.floor(Math.random() * data.length)];
                let trophyName = user.userName;

                for (let i = 1; i < 4; i++) {
                    let item = rpgShopGeneration(trophyName);
                    dbGame.push("/shop/item" + i + "/itemName", item.name);
                    dbGame.push("/shop/item" + i + "/strength", item.strength);
                    dbGame.push("/shop/item" + i + "/guile", item.guile);
                    dbGame.push("/shop/item" + i + "/magic", item.magic);
                    dbGame.push("/shop/item" + i + "/price", item.price);
                    dbGame.push("/shop/item" + i + "/slot", item.itemslot);
                }

                sendBroadcast('A new travelling salesman has come to town! Type !rpg-shop to see his supply.');
                deletePoints(userid, settings.cost);
            } else {
                console.log('Could not access mixer api for store item generation.');
                sendWhisper(username, "Something went wrong when refreshing the shop.");
            }
        });
    } else {
        sendWhisper(username, "You dont not have enough coins to refresh the shop or it is turned off.");
    }
}
function rpgShopGeneration(trophyName) {
    let diceRoller = (dice.roll({
        quantity: 1,
        sides: 20,
        transformations: ['sum']
    })).result;

    let item = [];

    if (diceRoller >= 1 && diceRoller <= 4) {
        // Melee Item
        item = buyMelee(null, null, true);
    } else if (diceRoller >= 5 && diceRoller <= 8) {
        // Ranged Item
        item = buyRanged(null, null, true);
    } else if (diceRoller >= 9 && diceRoller <= 11) {
        // Magic Item
        item = buyMagic(null, null, true);
    } else if (diceRoller >= 12 && diceRoller <= 14) {
        // Armor Item
        item = buyArmor(null, null, true);
    } else if (diceRoller >= 15 && diceRoller <= 17) {
        // Mount Item
        item = buyMount(null, null, true);
    } else if (diceRoller === 18) {
        // Title Item
        item = buyTitle(null, null, true);
    } else if (diceRoller === 19) {
        // Companion Item
        item = buyCompanion(null, null, true);
    } else {
        // Trophy Item
        item = buyTrophy(null, trophyName, null, true);
    }

    item.price = Math.floor(Math.random() * 2000) + 750;

    // Return Item
    return item;
}

// Buys something from the shop.
function rpgShopPurchase(username, userid, rawcommand) {
    let commandArray = (rawcommand).split(" ");
    let command = Math.floor(commandArray[1]);
    let item;

    if (isNaN(command) === false && command <= 3 && command > 0) {
        // Player is trying to purchase.

        try {
            item = dbGame.getData("/shop/item" + command);
        } catch (ignore) { } //eslint-disable-line no-empty

        if (item.price !== "sold") {
            // Great, this person exists!
            let pointsTotal = getPoints(userid);

            if (pointsTotal >= item.price && isNaN(item.price) === false) {
                // Item Bought
                sendWhisper(username, "You bought " + item.itemName + " for " + item.price + " coins. Type !rpg-equip to use it or !rpg-sell to sell it.");
                deletePoints(userid, item.price);
                dbGame.push("/shop/item" + command + "/price", "sold");

                // Push to player holding slot
                dbPlayerHolder(userid, "holding", item.slot, item.itemName, item.strength, item.guile, item.magic);
            } else {
                // Not enough points.
                sendWhisper(username, "You do not have enough coins for that item!");
            }
        } else {
            sendWhisper(username, "We are out of stock on that item.");
        }

    } else {
        // Whisper items in shop.
        let itemOne = dbGame.getData("/shop/item1");
        let itemTwo = dbGame.getData("/shop/item2");
        let itemThree = dbGame.getData("/shop/item3");

        sendWhisper(username, "[1 - cost: " + itemOne.price + "] " + itemOne.itemName + "(" + itemOne.slot + ": " + itemOne.strength + "/" + itemOne.guile + "/" + itemOne.magic + "), [2 - cost: " + itemTwo.price + "] " + itemTwo.itemName + "(" + itemTwo.slot + ": " + itemTwo.strength + "/" + itemTwo.guile + "/" + itemTwo.magic + "), [3 - cost: " + itemThree.price + "] " + itemThree.itemName + "(" + itemThree.slot + ": " + itemThree.strength + "/" + itemThree.guile + "/" + itemThree.magic + ")");
    }
}

// RPG Training
// This allows the user to spend coins to permanent gain a stat point.
function rpgTraining(username, userid) {
    let currentCoin,
        trainingSettings,
        strength,
        guile,
        magic;

    try {
        currentCoin = dbPlayers.getData('/' + userid + '/coins');
        trainingSettings = dbSettings.getData('/training');
    } catch (err) {
        sendWhisper('username', "Couldn't find your coin amount. Have you done !rpg-daily yet?");
        return;
    }

    if (currentCoin >= trainingSettings.cost && trainingSettings.active === true) {
        let mission = rpgApp.training[Math.floor(Math.random() * rpgApp.training.length)];
        let missionText = mission.text;
        let missionStrength = mission.strength;
        let missionGuile = mission.guile;
        let missionMagic = mission.magic;
        let missionCoin = mission.coins;

        try {
            strength = dbPlayers.getData("/" + userid + "/prowess/strength");
        } catch (error) {
            strength = 0;
        }
        try {
            guile = dbPlayers.getData("/" + userid + "/prowess/guile");
        } catch (error) {
            guile = 0;
        }
        try {
            magic = dbPlayers.getData("/" + userid + "/prowess/magic");
        } catch (error) {
            magic = 0;
        }

        // If mission gives stats...
        if (missionStrength > 0 || missionGuile > 0 || missionMagic > 0) {
            let newStrength = strength + missionStrength;
            let newGuile = guile + missionGuile;
            let newMagic = magic + missionMagic;
            dbPlayers.push("/" + userid + "/prowess/strength", newStrength);
            dbPlayers.push("/" + userid + "/prowess/guile", newGuile);
            dbPlayers.push("/" + userid + "/prowess/magic", newMagic);
            characterStats(userid);
        }

        // If mission gives coins...
        if (missionCoin > 0) {
            addPoints(userid, missionCoin);
        }

        // Send a whisper about what happened.
        missionText = `${missionText} || Prowess:(${missionStrength}/${missionGuile}/${missionMagic}) || ${missionCoin} coins.`;
        sendWhisper(username, missionText);
        deletePoints(userid, trainingSettings.cost);
    } else {
        sendWhisper(username, "You do not have enough coins to train, or training is turned off.");
    }
}

// Sell whatever is in the holding spot.
function rpgSell(userid) {
    let player = [];
    let sellPrice = dbSettings.getData('./sell/amount');
    try {
        player = dbPlayers.getData('/' + userid);
    } catch (err) {
        console.log(err);
        return;
    }

    if (player.holding !== null && player.holding !== undefined) {
        let holdingName = player.holding.name;
        dbPlayers.delete('/' + userid + '/holding');
        addPoints(userid, sellPrice);
        sendWhisper(player.username, 'You have sold a ' + holdingName + ' for ' + sellPrice + ' coins.');
    } else {
        sendWhisper(player.username, 'You aren\'t holding any items, so you have nothing to sell.');
    }
}

// Drink a potion
function rpgPotion(userid) {
    let player = [];
    try {
        player = dbPlayers.getData('/' + userid);
    } catch (err) {
        console.log(err);
        return;
    }

    if (player.backpack === null || player.backpack === undefined) {
        sendWhisper(player.username, 'You have nothing in your backpack to drink!');
        return;
    }

    // Set used to true if the person drank a potion.
    if (player.backpack.potion != null) {
        dbPlayers.push('/' + userid + '/backpack/potion/used', true);
        sendWhisper(player.username, 'You chug the potion. The stats will be added to your next combat.');
    } else {
        sendWhisper(player.username, 'You drink some air.');
    }
}


/**
function fixer(){
	var obj = dbPlayers.getData('/');
	Object.keys(obj).forEach(function(key) {
		let player = obj[key];
		console.log('Fixing '+player.username+'.');
		buyPotion(player.username, key);
	});
}
setTimeout(function(){
	fixer();
}, 10000);
*/
