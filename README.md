# Beam-RPG-Scotty
This is a chat based RPG for beam.pro that runs using scottybot and node.js. It allows users in chat to go on adventures, quests, raids, and many other things and saves character data to a json db.

Getting Started: <br>
1. Install node from https://nodejs.org/en/ <br>
2. Download this RPG onto your desktop.<br>
3. Go into beam-rpg/db/settings.json <br>
4. Put in your scottybot auth code from the scottybot GUI, and edit any other settings you see fit here. <br>
5. Time to create the scottybot commands we'll need! <br>
6. Run node.js and direct it to wherever you've stored the beam RPG folder. <br>
7. Type "node beam-rpg" to start up the service.

Scotty Commands: <br>
  - Open up the ScottyGUI and create the following commands:
  - !rpg : (_null_)
  - !rpg-adventure : (_null_) : Recommended cost of 200.
  - !rpg-daily : (_null_)(_bpcd_)
  - !rpg-equip : (_null_)(_bpcd_)
  - !rpg-inventory : (_null_)(_bpcd_)
  - !rpg-raid : (_null_)(_bpcd_)
  - Optional repeating command that tells people to try the !rpg command. <br>
  
FAQ:
- If someone runs an !rpg command and it does not show as in the node window that means the command was not create in the scotty gui.
