const fs = require('fs');
const favicon = require('serve-favicon');
const express = require('express');
const session = require('express-session');
const app = express();
const serv = require('http').Server(app);

var botNames = fs.readFileSync('botNames.json');

app.use(favicon(__dirname + '/client/favicon.ico'));

app.use('/client', express.static(__dirname + '/client'));

app.use(session({
   secret: 'jeans',
   resave: false,
   saveUninitialized: true,
   cookie: {maxAge: 60000}
}));

app.get('/', function(req, res) {
   res.sendFile(__dirname + '/client/index.html');
   var hour = 3600000;
   req.session.cookie.maxAge = hour;
});

serv.listen(process.env.PORT || 2000);
console.log("server started");

class Room {
   constructor(data) {
      this.botNames = JSON.parse(botNames);
      this.rawBots = fs.readFileSync('bots.json');
      this.bots = JSON.parse(this.rawBots);
      this.lobbyName = data.lobbyName;
      this.nPoints = data.maxPoints;
      this.public = data.public;
      this.botPlayers = [];
      this.players = [];
      this.activePlayers = [];
      this.idlePlayers = [];
      this.whosReady = 0;
      this.category = "";
      this.list = "";
      this.activePlayer = 0;
      this.challengable;
      this.timer;
      this.skips = 0;
      this.answer;
      this.votes = 0;
      this.time = 15;
      this.ff = data.ff;
      if (this.ff) {
         for (var item in this.bots) {
            if ("NSFW" in this.bots[item]) {
               delete this.bots[item];
            }
         }
      }
      this.catList = Object.keys(this.bots);
      this.ansArray = [];

      this.page = 'play';
      this.chatList = "";
      this.started = false;
   }

   reInit() {
      this.whosReady = 0;
      this.category = "";
      this.activePlayer = 0;
      this.skips = 0;
      this.votes = 0;
   }

   newGame() {
      this.started = true;
      this.players.forEach((player) => {
         player.points = 0;
         player.oldPoints = 0;
      });
      this.botPlayers.forEach((player) => {
         player.points = 0;
         player.oldPoints = 0;
      });
      this.newRound();
   }

   newRound() {
      this.list = "";
      this.skips = 0;
      this.whosReady = 0;
      this.players.forEach((player) => {
         player.socket.emit('updateList', this.list);
         player.oldPoints = player.points;
      });

      this.botPlayers.forEach((player) => {
         player.oldPoints = player.points;
      });

      this.challengable = false;
      this.players.forEach((player) => {
         player.socket.emit('newRoundInit', this.public);
      });

      this.roundSize = this.players.length + this.botPlayers.length;
      this.activePlayers = [...this.players];
      this.activePlayers.push.apply(this.activePlayers, this.botPlayers);
      this.activePlayer = 0;
      this.fillTurnmeter();
      this.category = this.catList.splice(Math.floor((Math.random() * this.catList.length)), 1)[0];
      this.ansArray = Object.keys(this.bots[this.category]);

      if (this.catList.length < 2) {
         this.catList = Object.keys(this.bots);
      }
      this.countdown(this);
   }

   countdown(room) {
      let count = 3;
      let countdown = setInterval(function(){
         if (count > 0) {
            room.players.forEach((player) => {
               player.socket.emit('updateCat', count);
            })
            count--;
         } else {
            room.players.forEach((player) => {
               player.socket.emit('updateCat', 'Name ' + room.category);
            });
            clearInterval(countdown);
            room.newTurn();
         }
      }, 1000);
   }

   newTurn() {
      this.time = 15;
      let room = this;

      if (this.activePlayer >= this.activePlayers.length) {
         this.activePlayer = 0;
      }

      let active = this.activePlayer;

      if (this.activePlayers[this.wrapIndex(active, 1)].socket.id in sockArray) {
         this.activePlayers[this.wrapIndex(active, 1)].socket.emit('nextIndicator');
      }

      if (this.activePlayers[active].socket.id in sockArray) {
         this.activePlayers[active].socket.emit('activate', {chall: this.challengable, public: this.public, ff: this.ff});
      } else if (this.activePlayers[active].bot) {
         this.activePlayers[active].answer = this.ansArray.splice(Math.floor(Math.random() * this.ansArray.length), 1)[0];
      } else {
         room.challengable = false;
         room.removePlayer(0, 'time');
         room.checkRoundEnd('norm');
         return;
      }

      this.timer = setInterval(function(){

         room.updateTurnmeter(room.activePlayers[active].name, (15 - room.time));

         room.time -= 0.25;
         if (room.activePlayers[active].socket.id in sockArray) {
            room.activePlayers[active].socket.emit('updateTimer', Math.round(room.time));
         } else if (room.activePlayers[active].bot) {

            if ((room.answer in room.bots[room.category]) && room.challengable && (Math.random() * 100 > room.bots[room.category][room.answer]) && (Math.random() > 0.6)) {
               clearInterval(room.timer);
               challenge(room);
            }

            if ((Math.random() > 0.7) && room.time < 11 && room.activePlayers[active].answer != undefined && room.activePlayers[active].answer != 'NSFW') {
               room.message({ans: room.activePlayers[active].answer, name: room.activePlayers[active].name});
            }
         }

         if (room.time <= 0) {
            clearInterval(room.timer);
            room.updateTurnmeter(room.activePlayers[active].name, 15);
            room.challengable = false;
            room.list += '<i>' + room.activePlayers[active].name + ' ran out of time' + '</i> <br/>'
            room.players.forEach((player) => {
               player.socket.emit('updateList', room.list);
            });
            if (room.activePlayers[active].bot) {
               room.outTurnmeter(room.activePlayers[active].name);
               let bpI = room.botPlayers.map(bot => bot.name).indexOf(room.activePlayers[active].name);
               room.botPlayers[bpI].points += room.roundSize - room.activePlayers.length;
               room.activePlayers.splice(active, 1);
            } else {
               room.removePlayer(0, 'time');
            }
            room.checkRoundEnd('norm');
         }
      }, 1000/4);
   }

   checkRoundEnd(mode) {
      let room = this;
      if (this.activePlayers.length < 2) {
         if (this.activePlayers.length > 0) {
            let playersIndex = (this.players.map(player => player.name)).indexOf(this.activePlayers[0].name);
            if (typeof this.players[playersIndex] != 'undefined') {
               this.players[playersIndex].points += this.roundSize - 1;
            }
            if (this.activePlayers[0].bot) {
               let botplayersIndex = (this.botPlayers.map(player => player.name)).indexOf(this.activePlayers[0].name);
               this.botPlayers[botplayersIndex].points += this.roundSize - 1;
            }
         }
         this.scoreboard();
      } else {
         if (mode == "vote") {
            this.players.forEach((player) => {
               player.socket.emit('changePage', 'play');
            });
            setTimeout(function() {
               clearInterval(room.timer);
               room.newTurn();
            }, 2000);
         } else {
            clearInterval(this.timer);
            this.newTurn();
         }
      }
   }

   scoreboard() {
      this.lobbyFill();
      let fillArray = this.players.concat(this.botPlayers);
      if (this.players.length > 0) {
         fillArray = fillArray.sort((a, b) => b.points - a.points);
         let stripped = fillArray.map(({name, points, oldPoints}) => ({name, points, oldPoints}));
         let isOver = (stripped[0].points >= this.nPoints);
         if (isOver) {
            this.started = false;
         }
         this.players.forEach((player) => {
            player.socket.emit('scoreboard', {
               players: stripped,
               win: isOver,
               public: this.public,
               ff: this.ff,
               nPoints: this.nPoints
            });
         });
      }
   }

   lobbyFill() {
      let scoreInner = "";
      let fillArray = this.players.concat(this.botPlayers);
      fillArray.forEach((player, i) => {
         scoreInner += "<div id='" + player.name + "Score' style='background: white; transition: 0.7s; min-width: 160px; max-width: 180px; height: 20px; left: 50%; transform: translateX(-50%); color: #ff99a8; font-weight: bold; font-size: 0.8rem; text-align: center; line-height: 20px; vertical-align: middle; position: absolute; top: " + (23 + (i*9)) + "%'>" + player.name + ": <strong>" + player.oldPoints + "</strong></div>";
      });

      let voteInner = "";
      // previous voteCard color - #ff99a8 //
      fillArray.forEach((player, i) => {
         voteInner += "<div id='" + player.name + "Vote' style='background: white; transition: 0.7s; width: 40%; height: 20px; line-height: 20px; left: 30%; color: black; font-weight: bold; font-size: 0.8rem; text-align: center; vertical-align: middle; position: absolute; top: " + (15 + (i*6)) + "%'>" + player.name.toString().toUpperCase() + "</div>";
      });

      this.players.forEach((player) => {
         player.socket.emit('lobbyFill', {sb: scoreInner, vote: voteInner});
      });
   }

   message(data) {
      if (!this.list.includes(": " + data.ans.trim().toUpperCase() + '<br/>') && data.ans.length > 0) {
         clearInterval(this.timer);
         this.answer = data.ans.trim().toUpperCase();
         this.list += data.name + ": " + data.ans.trim().toUpperCase() + '<br/>';
         this.players.forEach((player) => {
            player.socket.emit('updateList', this.list);
         });
         if (this.category in this.bots) {
            if (!(this.answer in this.bots[this.category])) {
               this.bots[this.category][this.answer] = 95;
            } else if (this.bots[this.category][this.answer] < 100) {
               this.bots[this.category][this.answer] += 5;
            }

            var writeData = JSON.stringify(this.bots, null, 3);
            fs.writeFileSync('bots.json', writeData);
         }

         this.updateTurnmeter(this.activePlayers[this.activePlayer].name, 15);
         this.activePlayer = this.wrapIndex(this.activePlayer, 1);
         this.challengable = true;
         this.newTurn();
         return true;
      } else {
         return false;
      }
   }

   vote(data) {
      if (!data.bot) {
         let ind = this.players.map(player => player.name).indexOf(data.name);
         this.players[ind].vote = data.vote;
      }

      if (data.vote) {
         this.votes++;
      } else {
         this.votes--;
      }

      this.whosReady++;
      if (this.whosReady >= (this.players.length + this.botPlayers.length)) {
         this.whosReady = 0;
         if (this.category in this.bots) {
            if ((this.answer in this.bots[this.category]) && !data.bot) {
               this.bots[this.category][this.answer] -= this.votes * 5;
               if (this.bots[this.category][this.answer] > 99) {
                  this.bots[this.category][this.answer] = 99;
               } else if (this.bots[this.category][this.answer] < 1) {
                  this.bots[this.category][this.answer] = 1;
               }
               var writeData = JSON.stringify(this.bots, null, 3);
               fs.writeFileSync('bots.json', writeData);
            }
         }
         this.lobbyFill();
         this.voteResult();
      }
   }

   voteResult() {
      this.challengable = false;
      let removedPlayer = this.removePlayer(this.votes, 'vote');
      let message = "";
      if (this.votes > 0) {
         message = "VOTE SUCCEEDED, " + removedPlayer.toString().toUpperCase() + " WAS VOTED OUT."
         this.updateTurnmeter(removedPlayer, 15);
         this.activePlayer = this.wrapIndex(this.activePlayer, -1);
      } else {
         message = "VOTE FAILED, " + removedPlayer.toString().toUpperCase() + " IS OUT."
      }

      let resultList = [];
      this.players.forEach((player, i) => {
         resultList[i] = {name: player.name, vote: player.vote}
      });

      this.botPlayers.forEach((player) => {
         resultList.push({name: player.name, vote: player.vote})
      });

      this.votes = 0;

      let room = this;
      setTimeout(function() {
         room.players.forEach((player) => {
            player.socket.emit('result', {playerVotes: resultList, message: message});
         });
      }, 2000);
   }

   removePlayer(result, reason) {
      if (result > 0) {
         result = 1;
      } else {
         result = 0;
      }

      let activeIndex = this.wrapIndex(this.activePlayer, -result);

      if (activeIndex < 0) {
         return 'error';
      }

      if (!this.activePlayers[activeIndex].bot) {
         if (typeof this.activePlayers[activeIndex] != 'undefined') {
            let removedName = this.activePlayers[activeIndex].name;
            this.activePlayers[activeIndex].socket.emit('out', {reason: reason, public: this.public});
            let playersIndex = (this.players.map(player => player.name)).indexOf(this.activePlayers[activeIndex].name);
            if (typeof this.players[playersIndex] != 'undefined') {
               this.players[playersIndex].points += this.roundSize - this.activePlayers.length;
            }
            this.activePlayers.splice(activeIndex, 1);
            this.updateTurnmeter(removedName, 15);
            this.outTurnmeter(removedName);
            return removedName;
         } else {
            return 'nobody'
         }
      } else {
         let removedName = this.activePlayers[activeIndex].name;
         this.activePlayers[activeIndex].points += this.roundSize - this.activePlayers.length;
         this.activePlayers.splice(activeIndex, 1);
         this.updateTurnmeter(removedName, 15);
         this.outTurnmeter(removedName);
         return removedName;
      }
   }

   wrapIndex(index, add) {
      index += add;
      if (index >= this.activePlayers.length) {
         index = 0;
      } else if (index < 0) {
         index = this.activePlayers.length - 1;
      }
      return index;
   }

   rejoin(socket) {
      socket.emit('updateChat', this.chatList);
      let clientCookie = socket.handshake.headers.cookie;
      let pCookies = this.idlePlayers.map(player => player.socket.handshake.headers.cookie);
      let cIndex = pCookies.indexOf(clientCookie);

      socket.id = this.idlePlayers[cIndex].socket.id;
      socket.name = this.idlePlayers[cIndex].socket.name;
      socket.lobbyIndex = this.idlePlayers[cIndex].socket.lobbyIndex;
      sockArray[socket.id] = socket;
      let adminCheck = this.idlePlayers[cIndex].admin;
      this.idlePlayers[cIndex].socket = socket;
      this.players.push(this.idlePlayers.splice(cIndex, 1)[0]);
      let pIndex = this.players.map(p => p.name).indexOf(socket.name);
      // let apIndex = this.activePlayers.map(p => p.name).indexOf(socket.name);
      // if (apIndex >= 0) {
      //    this.activePlayers[apIndex] = this.players[pIndex];
      // }

      socket.emit('rejoin', {name: socket.name, admin: adminCheck, started: this.started, public: this.public});
      this.list += '<i>' + socket.name + ' rejoined' + '</i> <br/>'
      this.players.forEach((player) => {
         player.socket.emit('updateList', this.list);
      });
      socket.emit('changePage', 'play');
   }

   again() {
      let room = this;
      if (!this.public) {
         this.whosReady++;
         if (this.whosReady >= this.players.length) {
            this.whosReady = 0;
            this.reInit();
            this.newGame();
         }
      } else {
         this.checkStart();
      }
   }

   changeRules(data) {
      if (this.ff && !data.ff) {
         this.catList.push(...nsfwCat);
         this.ff = false;
      } else if (!this.ff && data.ff) {
         this.catList = [...cat];
         this.ff = true;
      }

      this.nPoints = data.maxpoints;
      this.again();
   }

   chat(msg) {
      if (this.ff) {
         msg = msg.toLowerCase().replace(/fuck/g, "****");
         msg = msg.toLowerCase().replace(/fucking/g, "******");
         msg = msg.toLowerCase().replace(/shit/g, "****");
         msg = msg.toLowerCase().replace(/shitting/g, "******");
         msg = msg.toLowerCase().replace(/nigger/g, "****");
         msg = msg.toLowerCase().replace(/cunt/g, "****");
         msg = msg.toLowerCase().replace(/nigga/g, "****");
         msg = msg.toLowerCase().replace(/dick/g, "****");
         msg = msg.toLowerCase().replace(/sh1t/g, "****");
         msg = msg.toLowerCase().replace(/5h1t/g, "****");
         msg = msg.toLowerCase().replace(/5hit/g, "****");
         msg = msg.toLowerCase().replace(/d1ck/g, "****");
         msg = msg.toLowerCase().replace(/n1gger/g, "****");
         msg = msg.toLowerCase().replace(/n1gga/g, "****");
         msg = msg.toLowerCase().replace(/nigg4/g, "****");
         msg = msg.toLowerCase().replace(/pussy/g, "****");
         msg = msg.toLowerCase().replace(/pu55y/g, "****");
         msg = msg.toLowerCase().replace(/twat/g, "****");
         msg = msg.toLowerCase().replace(/tw4t/g, "****");
         msg = msg.toLowerCase().replace(/tit/g, "***");
         msg = msg.toLowerCase().replace(/tits/g, "****");
         msg = msg.toLowerCase().replace(/paki/g, "****");
         msg = msg.toLowerCase().replace(/prick/g, "****");
         msg = msg.toLowerCase().replace(/yid/g, "****");
      }
      this.chatList += msg;
      this.players.forEach((player) => {
         player.socket.emit('updateChat', this.chatList);
      });
   }

   checkStart() {
      let room = this;
      // if (this.players.length > 2 && !this.started) {
      if (!this.started) {
         this.started = true;
         let startTimer = 5;
         let pubStart = setInterval(function(){
            if (startTimer > 0) {
               room.players.forEach((player) => {
                  player.socket.emit('updateCat', 'Game starting in: ' + startTimer);
               })
               if ((Math.random() > 0.7) && room.players.length + room.botPlayers.length < 5) {
                  let botname = room.botNames.splice(Math.floor(Math.random() * room.botNames.length), 1);
                  room.botPlayers.push({
                     name: botname[0],
                     points: 0,
                     oldPoints: 0,
                     bot: true,
                     admin: false,
                     answer: "",
                     socket: {id: Math.random()}
                  });
                  room.chat('<i>' + botname + ' joined' + '</i> <br/>');
               }
               startTimer--;
            } else {
               clearInterval(pubStart);
               if (room.players.length + room.botPlayers.length < 3) {
                  let amount = 3 - (room.players.length + room.botPlayers.length);
                  for (var i = 0; i <= amount; i++) {
                     let botname = room.botNames.splice(Math.floor(Math.random() * room.botNames.length), 1);
                     room.botPlayers.push({
                        name: botname[0],
                        points: 0,
                        oldPoints: 0,
                        bot: true,
                        admin: false,
                        answer: "",
                        socket: {id: Math.random()}
                     });
                     room.chat('<i>' + botname + ' joined' + '</i> <br/>');
                  }
               }
               let l = (room.players.length + room.botPlayers.length);
               if (l > 8)  {
                  room.nPoints = 30;
               } else if (l > 6) {
                  room.nPoints = 25;
               } else if (l > 4) {
                  room.nPoints = 20;
               } else {
                  room.nPoints = 15;
               }

               room.newGame();
            }
         }, 1000);
      }
   }

   moveToIdle(sock) {
      let index = this.players.map(ele => ele.name).indexOf(sock.name);
      this.idlePlayers.push(this.players.splice(index, 1)[0]);

      this.list += '<i>' + sock.name + ' left' + '</i> <br/>';
      this.players.forEach((player) => {
         player.socket.emit('updateList', this.list);
      });
   }

   removeIdle(sock) {
      let idlePos = this.idlePlayers.map(pl => pl.name).indexOf(sock.name);
      this.idlePlayers.splice(idlePos, 1);
   }

   skip() {
      for (var i = 0; i < (this.activePlayers.length); i++) {
         if (this.activePlayer != i && !this.activePlayers[i].bot) {
            this.activePlayers[i].socket.emit('votePrompt', this.category);
         }
      };
      let room = this;
      setTimeout(function() {
         if (room.botPlayers.length > 0) {
            room.botPlayers.forEach((bot) => {
               if (Math.random() > 0.4) {
                  room.skips++;
               }
            });
            if (room.skips >= room.players.length + room.botPlayers.length) {
               clearInterval(room.timer);
               room.newRound();
            }
         }
      }, 2000);
   }

   botVote(challenger, challangee) {
      if (this.answer in this.bots[this.category]) {
         this.botPlayers.forEach((player) => {
            // console.log(challenger, challangee, player.name);
            if (challangee.name == player.name) {
               this.vote({
                  name: player.name,
                  vote: 0,
                  bot: true
               })
               player.vote = 0;
               return;
            }
            if (Math.random() * 100 > this.bots[this.category][this.answer] || player.name == challenger) {
               this.vote({
                  name: player.name,
                  vote: 1,
                  bot: true
               })
               player.vote = 1;
            } else {
               this.vote({
                  name: player.name,
                  vote: 0,
                  bot: true
               })
               player.vote = 0;
            }
         });
      } else {
         this.botPlayers.forEach((player) => {
            let thisVote = Math.round(Math.random())
            this.vote({
               name: player.name,
               vote: thisVote,
               bot: true
            })
            player.vote = thisVote;
         });
      }
   }

   fillTurnmeter() {
      let turnHTML = "";
      this.activePlayers.forEach((p) => {
         turnHTML += '<div id="turnBlock' + p.name + '"class="turnBlock">' + p.name + '<div id="turnTimer' + p.name + '" class="turnTimer"></div></div>'
      });

      this.players.forEach((p) => {
         p.socket.emit('fillTurnmeter', turnHTML);
      })
   }

   updateTurnmeter(name, time) {
      this.players.forEach((p) => {
         if (p.name != name) {
            p.socket.emit('tickTurnmeter', {name: name, time: time});
         }
      });
   }

   outTurnmeter(name) {
      this.players.forEach((p) => {
         p.socket.emit('outTurnmeter', name);
      })
   }
}

var rooms = [];
var sockArray = {}

var io = require('socket.io')(serv, {});
io.sockets.on('connection', function(socket) {

   let hasCookie = false;
   let clientCookie = socket.handshake.headers.cookie;
   rooms.forEach((room, i) => {
      let cookies = room.idlePlayers.map(player => player.socket.handshake.headers.cookie);
      if (cookies.includes(clientCookie)) {
         socket.emit('hasCookie', {index: i, name: room.lobbyName});
         hasCookie = true;
      }
   });

   if (!hasCookie) {
      socket.id = Math.random();
      sockArray[socket.id] = socket;
   }

   // socket.id = Math.random()
   // sockArray[socket.id] = socket;

   socket.on('disconnect', function() {
      if ('lobbyIndex' in socket && typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].moveToIdle(socket);
      }
      wasteRemoval();
      delete sockArray[socket.id];
   });

   socket.on('confirmRejoin', function(roomIndex) {
      if (typeof rooms[roomIndex] != 'undefined') {
         rooms[roomIndex].rejoin(socket);
      }
   });

   socket.on('denyRejoin', function() {
      socket.id = Math.random();
      sockArray[socket.id] = socket;
   })

   socket.on('createLobby', function(data) {
      if (!rooms.map(room => room.lobbyName).includes(data.lobby)) {
         rooms.push(new Room({
            lobbyName: data.lobby,
            ff: data.familyFriendly,
            maxPoints: data.maxpoints,
            public: false
         }));

         joinRoom({
            name: data.name,
            roomName: data.lobby,
            sid: socket.id,
            socket: socket,
            admin: true
         });
         socket.emit('createLobbyHandshake', true);
      } else {
         socket.emit('createLobbyHandshake', false);
      }
   });

   socket.on('join', function(data) {
      let nameOk = false;
      let lobbyOk = false;
      let lobbySpace = false;

      if (rooms.map(item => item.lobbyName).includes(data.roomName)) {
         lobbyOk = true;
         let index = rooms.map(item => item.lobbyName).indexOf(data.roomName);
         let players = rooms[index].players.map(player => player.name);

         if (players.length < 9) {
            lobbySpace = true;
         } else {
            socket.emit('joinHandshake', {success: false, reason: "full"})
         }

         if (!players.includes(data.name)) {
            nameOk = true;
         } else {
            socket.emit('joinHandshake', {success: false, reason: "name"})
         }
      } else {
         socket.emit('joinHandshake', {success: false, reason: "room"});
      }

      if (lobbyOk && nameOk && lobbySpace) {
         joinRoom({
            name: data.name,
            sid: socket.id,
            roomName: data.roomName,
            socket: socket,
            admin: false
         });
         socket.emit('joinHandshake', {success:true});
      }

   });

   socket.on('find', function(data) {
      if (data.ff) {
         if (isNSFW(data.name)) {
            socket.emit('findHandshake', {success: false, reason: 'profanity'});
            return;
         };
      }


      let publicRooms = rooms.filter(room => room.public == true);
      let roomsWithSpace = publicRooms.filter(room => room.players.length < 9);
      let roomNameSend;

      roomsWithSpace = roomsWithSpace.filter(room => room.ff == data.ff);


      if (roomsWithSpace.length < 1) {
         let pubName = Math.random()
         roomNameSend = pubName;
         rooms.push(new Room({
            lobbyName: pubName,
            ff: data.ff,
            maxPoints: 30,
            public: true
         }));

         joinRoom({
            name: data.name,
            sid: socket.id,
            roomName: pubName,
            socket: socket,
            admin: false
         });

      } else {
         roomsWithSpace.sort((a, b) => a.players.length - b.players.length);
         if (roomsWithSpace[0].players.map(player => player.name).includes(data.name)) {
            socket.emit('findHandshake', {success: false, reason: 'taken'});
            return;
         }
         roomNameSend = roomsWithSpace[0].lobbyName;
         joinRoom({
            name: data.name,
            sid: socket.id,
            roomName: roomsWithSpace[0].lobbyName,
            socket: socket,
            admin: false
         });
      }


      socket.emit('findHandshake', {success: true, roomName: roomNameSend});
   });

   socket.on('ready', function() {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].newGame();
      }
   });

   socket.on('again', function() {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].again();
      }
   });

   socket.on('exit', function() {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         let room = rooms[socket.lobbyIndex];
         let sockIndex = room.players.map(player => player.sid).indexOf(socket.id);
         room.players.splice(sockIndex, 1);
         room.list += '<i>' + socket.name + ' left' + '</i> <br/>';
         room.players.forEach((player) => {
            player.socket.emit('updateList', room.list);
         });
         wasteRemoval();
      }
   });

   socket.on('answer', function (answer) {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         if (rooms[socket.lobbyIndex].message({ans: answer, name: socket.name})) {
            socket.emit('answerHandshake');
         } else {
            socket.emit('dupe', 'inputBox');
         }
      }
   });

   socket.on('skip', function() {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         // socket.emit('answerHandshake', this.public);
         // clearInterval(rooms[socket.lobbyIndex].timer);
         // rooms[socket.lobbyIndex].challengable = false;
         rooms[socket.lobbyIndex].list += '<i>' + socket.name + ' voted to skip</i><br/>';
         rooms[socket.lobbyIndex].players.forEach((player) => {
            player.socket.emit('updateList', rooms[socket.lobbyIndex].list);
         });

         if (rooms[socket.lobbyIndex].skips == 0) {
            rooms[socket.lobbyIndex].skip();
         }

         rooms[socket.lobbyIndex].skips++;

         if (rooms[socket.lobbyIndex].skips >= rooms[socket.lobbyIndex].players.length + rooms[socket.lobbyIndex].botPlayers.length) {
            clearInterval(rooms[socket.lobbyIndex].timer);
            rooms[socket.lobbyIndex].newRound();
         }
      }
   });

   socket.on('challenge', function() {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         challenge(rooms[socket.lobbyIndex]);
      }
   });

   socket.on('voteReply', function(data) {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].vote({name: data.name, vote: data.vote, bot: false});
      }
   })

   socket.on('voteOver', function() {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].whosReady++;

         if (rooms[socket.lobbyIndex].whosReady < rooms[socket.lobbyIndex].players.length) {
            return;
         } else {

            setTimeout(function() {
               rooms[socket.lobbyIndex].whosReady = 0;
               rooms[socket.lobbyIndex].checkRoundEnd('vote');
            }, 3500);
         }
      }
   });

   socket.on('nextRound', function(){
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].whosReady++;
         if (rooms[socket.lobbyIndex].whosReady < (rooms[socket.lobbyIndex].players.length)) {
            return;
         } else {
            rooms[socket.lobbyIndex].whosReady = 0;
            rooms[socket.lobbyIndex].newRound();
         }
      }
   });

   socket.on('updatePage', function(page) {
      if ('lobbyIndex' in socket && typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].page = page;
      }
   });

   socket.on('changeRules', function(data) {
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].changeRules(data);
      }
   });

   socket.on('chat', function(chat) {
      let message = "<strong>" + socket.name + ":</strong> " + chat + '<br/>';
      if (typeof rooms[socket.lobbyIndex] != 'undefined') {
         rooms[socket.lobbyIndex].chat(message);
      }
   });

   socket.on('suggest', function(cat) {
      var suggestionFile = fs.readFileSync('suggestions.json');
      var suggestions = JSON.parse(suggestionFile);
      suggestions.push(cat);
      var suggestionsNew = JSON.stringify(suggestions, null, 3);
      fs.writeFileSync('suggestions.json', suggestionsNew);
   })
});

function joinRoom(data) {
   takeName(data.name);
   let player = {
      name: data.name,
      sid: data.sid,
      socket: data.socket,
      lobby: data.roomName,
      lobbyIndex: rooms.map(room => room.lobbyName).indexOf(data.roomName),
      points: 0,
      oldPoints: 0,
      admin: data.admin,
      bot: false
   }
   let room = rooms[player.lobbyIndex];
   room.players.push(player);
   data.socket.lobbyIndex = player.lobbyIndex;
   data.socket.name = player.name;
   checkForOldRoom(data.socket);
   if (room.public) {
      room.checkStart();
      data.socket.emit('showChat');
      room.chat('<i>' + player.name + ' joined' + '</i> <br/>');
      // if (room.players.length < 3) {
      //    room.chat('<i>' + 'Waiting for ' + (3 - room.players.length) + ' more player(s)</i> <br/>');
      // } else if (room.players.length == 3) {
      //       room.chat('<i>' + 'Game starting</i> <br/>');
      // }
   } else {
      room.list += '<i>' + player.name + ' joined' + '</i> <br/>'
      room.players.forEach((player) => {
         player.socket.emit('updateList', room.list);
      });
   }
}

function checkForOldRoom(sock) {
   let clientCookie = sock.handshake.headers.cookie;
   rooms.forEach((room) => {
      let cookies = room.idlePlayers.map(player => player.socket.handshake.headers.cookie);
      if (cookies.includes(clientCookie)) {
         room.removeIdle(sock);
      }
   });
}

function wasteRemoval() {
   rooms.forEach((room, i) => {
      if (room.players.length < 1) {
         rooms.splice(i, 1);
      }
   });

}

function takeName(name) {
   // botNames.push(name);
   // db.update({doc: 'botNames'}, {$set: {data: botNames}});
   let oldBotNames = JSON.parse(botNames);
   if (!(oldBotNames.includes(name)) && !isNSFW(name)) {
      oldBotNames.push(name);
      var botnameData = JSON.stringify(oldBotNames, null, 3);
      fs.writeFileSync('botNames.json', botnameData);
   }
}

function challenge(room) {
   clearInterval(room.timer);

   if (room.answer in room.bots[room.category]) {
      room.bots[room.category][room.answer] -= 5;
      var writeData = JSON.stringify(room.bots, null, 3);
      fs.writeFileSync('bots.json', writeData);
   }

   let challangee = room.activePlayers[room.wrapIndex(room.activePlayer, -1)];
   room.botVote(room.activePlayers[room.activePlayer].name, challangee);
   room.players.forEach((player) => {
      player.socket.emit('answerHandshake', {pub: this.public, ff: this.ff});
      player.socket.emit('vote', {
         ans: room.answer,
         cat: room.category,
         public: room.public,
         ff: room.ff})
      });
}

function isNSFW(name) {
   let swears = [
      'fuck',
      'fuckin',
      'shit',
      'shitting',
      'nigger',
      'cunt',
      'nigga',
      'dick',
      'sh1t',
      '5h1t',
      '5hit',
      'd1ck',
      'n1gger',
      'n1gga',
      'nigg4',
      'pussy',
      'pu55y',
      'twat',
      'tw4t',
      'tit',
      'tits',
      'paki',
      'prick'];
   if (swears.includes(name)) {
      return true;
   } else {
      return false;
   }
}
