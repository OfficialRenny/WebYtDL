# WebYTDL
A browser-based youtube downloader.
Just something I quickly built for fun and to mess around with websockets and stuff.
![](https://i.imgur.com/pZCiTOM.png)
#### Some features include:
 - Downloading a video as an mp3
 - Downloading a video as just video without sound
 - Downloading a video as a combined video + audio file
   - A quick option, but with a maximum resolution of 360p
   - A kinda slow option, but grabs the highest quality video and audio then combines them into an mkv (similar to what the cli tool [youtube-dl](https://github.com/ytdl-org/youtube-dl/) does)
   - A very slow option, which grabs the highest quality video and audio, then transcodes the video with libx264, converts the audio to mp3, then uses both to spit out an MP4.
 - Use of websockets which sends the user updates such as download progress on the server, and what ffmpeg is currently doing + any errors that may occur.
![](https://i.imgur.com/JxCnPxk.png)

#### Requirements
- NodeJS (used v12.8 myself)
  - Some dependencies from npm (just run `npm install`)
    - ejs
    - express
    - fluent-ffmpeg
    - uuid
    - ws
    - ytdl-core
- [ffmpeg](https://ffmpeg.org/) in your PATH
- A beefy CPU for the slow video + audio options

Originally built and tested on a localhost site, may need some tweaks if you'd like to put this on an actual server (and some extra tweaks on top if you want the websockets to work over https)

![](https://i.imgur.com/U6JYfhp.png)
![](https://i.imgur.com/8NOUl22.png)

> Written with [StackEdit](https://stackedit.io/) (because I'm lazy).
