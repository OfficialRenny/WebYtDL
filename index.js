const express = require("express");
const fs = require('fs');
const ws = require('ws');
const { v4: uuidv4 } = require('uuid');
const ytdl = require('ytdl-core');
var ffmpeg = require('fluent-ffmpeg');

const idMap = new Map();

const app = express();

app.use(express.static('public'))
app.use(express.json());      // if needed
app.engine('.html', require('ejs').renderFile);

const wsServer = new ws.Server({ noServer: true });
wsServer.on('connection', function (socket) {

    socket.uuid = uuidv4();
    idMap.set(socket.uuid, socket);

    socket.send(stringify({ action: "update-uuid", uuid: socket.uuid }));

    socket.currentDownloadProgress = "";

    socket.on('close', function () {
        idMap.delete(socket.uuid);
    });

    socket.on('message', function (msg) {
        try {
            var msgBody = JSON.parse(msg);
            if (msgBody.action == "grab-progress") {
                socket.send(stringify({ action: 'progress', progress: socket.currentDownloadProgress }));
            }
            if (msgBody.action == "uuid-test") {
                socket.send(stringify({ action: 'uuid-test', uuid: socket.uuid }));
            }
        } catch (ex) {
            console.log("Error parsing incoming WS message", ex);
        }
    });
});

const fileLimit = 5000 * 1024 * 1024;

app.get('/', function (req, res)  {
    res.render('index.html');
})

app.post('/api', async function (req, res) {
    var link =  req.body.youtubeLink;
    var type = req.body.fileType;
    var requesteeUUID = req.body.uuid;

    if (requesteeUUID) {
        let user = idMap.get(requesteeUUID);
        if (!user.currentDownloadProgress) {
            user.currentDownloadProgress = "";
            idMap.set(requesteeUUID, user);
        }
    }

    if (ytdl.validateURL(link) || ytdl.validateID(link)) {
        try {
            var videoName = "Test.whatever";
            var videoInfo = await ytdl.getInfo(link);
            var videoDetails = videoInfo.videoDetails;
            videoName = `${videoDetails.title} - ${videoDetails.videoId}`;

            if (requesteeUUID) {
                let user = idMap.get(requesteeUUID);
                user.currentDownloadProgress = `Received request for ${videoName}`;
                idMap.set(requesteeUUID, user);
            }

            res.set("File-Name", encodeURIComponent(videoName));

            if (type == "audio-only") {
                var vidAudio = await ytdl(link, {
                    quality: "highestaudio",
                    filter: "audioonly",
                });
                let command = ffmpeg();
                command.addInput(vidAudio).withAudioCodec('libmp3lame').format("mp3").stream(res);
                return;
            }
            if (type == "video-only") {
                ytdl(link, {
                    quality: "highestvideo",
                    filter: "videoonly",
                }).pipe(res);
                return;
            }
            if (type == "video-and-audio-fast") {
                ytdl(link, {
                    quality: "highest",
                }).pipe(res);
                return;
            }
            if (type == "video-and-audio-kinda-slow") {
                var audioFormat = ytdl.chooseFormat(videoInfo.formats, { filter: "audioonly", quality: "highest" }).container;
                var videoFormat = ytdl.chooseFormat(videoInfo.formats, { filter: "videoonly", quality: "highest" }).container;

                var hqAudio = await ytdl(link, {
                    quality: "highestaudio",
                    filter: "audioonly",
                }).on('progress', function (_, DLed, total) {
                    if (requesteeUUID) {
                        let user = idMap.get(requesteeUUID);
                        user.currentDownloadProgress = `Downloading Audio: ${(DLed / 1024 / 1024).toPrecision(4)}MB out of ${(total / 1024 / 1024).toPrecision(4)}MB`;
                        idMap.set(requesteeUUID, user);
                    }
                });
                var hqVideo = await ytdl(link, {
                    quality: "highestvideo",
                    filter: "videoonly",
                }).on('progress', function (_, DLed, total) {
                    if (requesteeUUID) {
                        let user = idMap.get(requesteeUUID);
                        user.currentDownloadProgress = `Downloading Video: ${(DLed / 1024 / 1024).toPrecision(4)}MB out of ${(total / 1024 / 1024).toPrecision(4)}MB`;
                        idMap.set(requesteeUUID, user);
                    }
                });

                var dateTime = new Date().getTime().toString();
                var videoPath = `./temp/${dateTime}-${videoName}-video.${videoFormat}`;
                var audioPath = `./temp/${dateTime}-${videoName}-audio.${audioFormat}`;

                await ytdlWriteFilePromise(hqVideo, videoPath);
                await ytdlWriteFilePromise(hqAudio, audioPath);

                var goodVideoSize = await goodFileSize(videoPath);
                var goodAudioSize = await goodFileSize(audioPath);



                if (!(goodVideoSize) || !(goodAudioSize)) {
                    console.log("Encountered too large of a file", goodVideoSize, goodAudioSize);
                    deleteFile(audioPath);
                    deleteFile(videoPath);
                    throw "Either your video or audio is too large, please choose a shorter/smaller video!"
                }

                res.set("File-Format", "mkv");

                let command2 = ffmpeg();
                command2
                    .input(audioPath)
                    .input(videoPath)
                    .withVideoCodec("copy")
                    .withAudioCodec("copy")
                    //.withOptions(["-flags +global_header", "-movflags frag_keyframe+faststart"])
                    .format("matroska")
                    .on('start', function () {
                        if (idMap.get(requesteeUUID)) {
                            let user = idMap.get(requesteeUUID);
                            user.currentDownloadProgress = "Started combining audio + video";
                            idMap.set(requesteeUUID, user);
                        }
                    })
                    .on('error', function(err) {
                        console.log('An error occurred: ' + err.message);
                        deleteFile(audioPath);
                        deleteFile(videoPath);

                        if (idMap.get(requesteeUUID)) {
                            let user = idMap.get(requesteeUUID);
                            user.currentDownloadProgress = `An error occurred with ffmpeg, please try again. If the problem persists, don't try again.`;
                            idMap.set(requesteeUUID, user);
                        }
                    })
                    .on('end', function() {
                        console.log('Processing finished!');
                        deleteFile(audioPath);
                        deleteFile(videoPath);
                    })
                    .on('progress', function (progress) {
                        if (idMap.get(requesteeUUID)) {
                            let user = idMap.get(requesteeUUID);
                            user.currentDownloadProgress = `Frames: ${progress.frames}. Current FPS: ${progress.currentFps}. Current Kbps: ${progress.currentKbps}. Target Size: ${progress.targetSize}. Timemark: ${progress.timemark}, Percent: ${Math.round(progress.percent)}.`;
                            idMap.set(requesteeUUID, user);
                        }
                    })
                    .pipe(res);
                return;
            }
            if (type == "video-and-audio-very-slow") {
                var audioFormat = ytdl.chooseFormat(videoInfo.formats, { filter: "audioonly", quality: "highest" }).container;
                var videoFormat = ytdl.chooseFormat(videoInfo.formats, { filter: "videoonly", quality: "highest" }).container;

                var hqAudio = await ytdl(link, {
                    quality: "highestaudio",
                    filter: "audioonly",
                }).on('progress', function (_, DLed, total) {
                    if (requesteeUUID) {
                        let user = idMap.get(requesteeUUID);
                        user.currentDownloadProgress = `Downloading Audio: ${(DLed / 1024 / 1024).toPrecision(4)}MB out of ${(total / 1024 / 1024).toPrecision(4)}MB`;
                        idMap.set(requesteeUUID, user);
                    }
                });
                var hqVideo = await ytdl(link, {
                    quality: "highestvideo",
                    filter: "videoonly",
                }).on('progress', function (_, DLed, total) {
                    if (requesteeUUID) {
                        let user = idMap.get(requesteeUUID);
                        user.currentDownloadProgress = `Downloading Video: ${(DLed / 1024 / 1024).toPrecision(4)}MB out of ${(total / 1024 / 1024).toPrecision(4)}MB`;
                        idMap.set(requesteeUUID, user);
                    }
                });

                var dateTime = new Date().getTime().toString();
                var videoPath = `./temp/${dateTime}-${videoName}-video.${videoFormat}`;
                var audioPath = `./temp/${dateTime}-${videoName}-audio.${audioFormat}`;

                await ytdlWriteFilePromise(hqVideo, videoPath);
                await ytdlWriteFilePromise(hqAudio, audioPath);

                var goodVideoSize = await goodFileSize(videoPath);
                var goodAudioSize = await goodFileSize(audioPath);



                if (!(goodVideoSize) || !(goodAudioSize)) {
                    console.log("Encountered too large of a file", goodVideoSize, goodAudioSize);
                    deleteFile(audioPath);
                    deleteFile(videoPath);
                    throw "Either your video or audio is too large, please choose a shorter/smaller video!"
                }

                let command2 = ffmpeg();
                command2
                    .input(audioPath)
                    .input(videoPath)
                    .withVideoCodec("libx264")
                    .withAudioCodec("aac")
                    .withOptions(["-flags +global_header", "-movflags frag_keyframe+faststart"])
                    .format("mp4")
                    .on('start', function () {
                        if (idMap.get(requesteeUUID)) {
                            let user = idMap.get(requesteeUUID);
                            user.currentDownloadProgress = "Started combining audio + video";
                            idMap.set(requesteeUUID, user);
                        }
                    })
                    .on('error', function(err) {
                        console.log('An error occurred: ' + err.message);
                        deleteFile(audioPath);
                        deleteFile(videoPath);

                        if (idMap.get(requesteeUUID)) {
                            let user = idMap.get(requesteeUUID);
                            user.currentDownloadProgress = `An error occurred with ffmpeg, please try again. If the problem persists, don't try again.`;
                            idMap.set(requesteeUUID, user);
                        }
                    })
                    .on('end', function() {
                        console.log('Processing finished!');
                        deleteFile(audioPath);
                        deleteFile(videoPath);
                    })
                    .on('progress', function (progress) {
                        if (idMap.get(requesteeUUID)) {
                            let user = idMap.get(requesteeUUID);
                            user.currentDownloadProgress = `Frames: ${progress.frames}. Current FPS: ${progress.currentFps}. Current Kbps: ${progress.currentKbps}. Target Size: ${progress.targetSize}. Timemark: ${progress.timemark}, Percent: ${Math.round(progress.percent)}.`;
                            idMap.set(requesteeUUID, user);
                        }
                    })
                    .pipe(res);
                return;
            }

            throw "Didn't find any audio/video to send...";
        } catch (ex) {
            console.log(ex);
            res.status(500).send("Error. " + ex);
        }
    } else {
        res.status(500).send("Error, invalid link.");
    }
});

function stringify(thisObj) {
    return JSON.stringify(thisObj);
}

async function ytdlWriteFilePromise (ytdl, path) {
    return new Promise(function (resolve, reject) {
        ytdl.pipe(fs.createWriteStream(path)
            .on('open', function () {
                console.log(`${path} started downloading.`);
            })
            .on('finish', function () {
                console.log(`${path} finished downloading`);
                resolve(true);
            })
            .on('error', function(err) {
                console.log(err);
                reject(false);
            })
        )
        .on('error', function(err) {
            console.log(err);
            reject(false);
        });
    });
}

async function deleteFile (path) {
    fs.stat(path, function (statErr, stats) {
        if (statErr) {
            return console.log(`Could not find file at ${path}`);
        } else {
            fs.unlink(path, (err) => {
                if (err) console.log(err);
            });
        }
    });
}

async function goodFileSize (path) {
    return new Promise(function (resolve, reject) {
        fs.stat(path, function (statErr, stats) {
            if (statErr) {
                resolve(true);
            } else {
                console.log(`${path} - ${stats.size} - ${(stats.size > fileLimit) ? false : true}`);
                return (stats.size > fileLimit) ? reject(false) : resolve(true);
            }
        });
    });
}

const server = app.listen(8081, () => console.log(`Server is up`));
server.on('upgrade', (request, socket, head) => {
    wsServer.handleUpgrade(request, socket, head, socket => {
        wsServer.emit('connection', socket, request);
    });
});