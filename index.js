
// Importing modules
const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { exec } = require("child_process");
const { Configuration, OpenAIApi } = require("openai");
const request = require('request').defaults({ encoding: null });
const client = new Client({
    authStrategy: new LocalAuth()
});

const fs = require('fs');
const axios  = require('axios');
const whisper_model = "whisper-1";
const FormData = require('form-data');
const { randomInt } = require('crypto');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const userdatajson = './data/userdata.json';

// Load environment variables from .env file
require('dotenv').config()

// Generate and scan QR code
client.on('qr', (qr) => {
    qrcode.generate(qr, {small: true});
});

// Session
client.on('ready', () => {
    client.sendMessage("31612654829@c.us", "Bot is back online");
});

// Login with session data, if it has been previously saved
client.initialize();

// OpenAI API
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Listen for messages
client.on('message', message => {

console.log("Message received from " + message.from + ": " + message.body);

    // generate a help message with all commands
    if(message.body.toLowerCase() == "help") {
        Explanation = "Commands:\n\n";
        Explanation += "*#* - _Generate text_\n";
        Explanation += "*/* - _Generate image_\n\n";
        Explanation += "*toggletranslate*: \n _Enable/Disable translation tool_\n\n";
        Explanation += "_Translation tool is disabled by default_";
        message.reply(Explanation);
    }

    // get the settings for the user
    if(message.body.toLowerCase() == "settings") {
        console.log("Get settings for " + message.from + "");
        settings = getUserSettings(message.from);
        usersettings = 'Settings:\n\n';

        if (typeof settings.translation === 'string') {
            usersettings += '*Translation*: _'+ settings.translation +'_\n';
        }
        if (settings.translation) {
            usersettings += '*Translation*: _enabled_\n';
        } else {
            usersettings += '*Translation*: _disabled_\n';
        }

        message.reply(usersettings);
    }

    // generate text
    if(message.body.startsWith("#")) {
        runCompletion(message.body.substring(1)).then(result => message.reply(result));
    }

    // generate image
    if(message.body.startsWith("/")) {
        GenerateImage(message.body.substring(1), message);
	}

    // toggle translation tool
    if(message.body.toLowerCase().startsWith("toggletranslate")) {
        console.log("Toggle translate for " + message.from + "");
        toggleTranslate(message);
    }

    // transcribe audio messages and if translation is enabled, translate the text from and to ukranian
    if(message.hasMedia) {
        if(message.type == 'audio' || message.type == 'ptt'){
            // download media and transcribe
            console.log("Audio message received");
            message.downloadMedia().then(media => {
                transcribeAudio(media.data, message, getUserData(message.from, "translation"));
            });
        }
    }

    // admin commands
    if(message.from.startsWith("31612654829@")) {

        // get admin commands
        if(message.body.toLowerCase() == "!admin") {
            message.reply("Commands:\n\n!reboothost\n!restartapp\n!chatid");
        }

        // reboot host
        if(message.body.toLowerCase() == "!reboothost") {
            message.reply("Rebooting...");
            reboothost();
        }

        if(message.body.toLowerCase() == "!restartapp") {
            message.reply("Restarting app...");
            restartapp();
        }

        // get chat id
        if(message.body.toLowerCase() == "!chatid") {
            message.reply(message.from);
        }
    }
});


// Generate Text
async function runCompletion (message) {
    const completion = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: message,
        max_tokens: 3000,
    });
    return completion.data.choices[0].text;
}

// Generate Image
async function GenerateImage(messagetext, message) {
	const response = await openai.createImage({
						prompt: messagetext,
						n: 1,
						size: "1024x1024",
					});

	image_url = response.data.data[0].url;

    request.get(image_url, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            data = Buffer.from(body).toString('base64');

            const media = new MessageMedia('image/png', data);
            message.reply(media);
        }
    });
}

// Transcribe Audio
async function transcribeAudio(audio, message, translation) {
    // create random file name and FormData object
    const formData = new FormData();
    const tempfilename = randomInt(16).toString();
    const tempfilepathogg = `./audio/${tempfilename}.ogg`;
    const filenamem4a = `${tempfilename}.mp3`;
    const tempfilepathm4a = `./audio/${filenamem4a}`;
    const filepathogg = path.join(__dirname, tempfilepathogg);
    const filepathm4a = path.join(__dirname, tempfilepathm4a);

    // convert base64 to buffer
    buffer = Buffer.from(audio, 'base64')

    // write file to disk
    fs.writeFileSync(filepathogg, buffer);
    console.log('file written to disk as ' + filepathogg + ' (' + buffer.length + ' bytes)');

    // create form data
    formData.append('model', whisper_model);

    // convert audio to m4a
    await convertAudio(filepathogg, filepathm4a);

	converted = fs.createReadStream(filepathm4a);

    // send form data to OpenAI
    formData.append('file', converted);

    axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
        }
    }).then(response => {
        translate(response.data.text, message);
    });
}

// Convert Audio
function convertAudio(input, output) {
    return new Promise((resolve,reject)=>{
      ffmpeg(input)
         .saveToFile(output)
         .on('end', () => {
            console.log('FFmpeg done!')
            return resolve();
         })
         .on('error',(err)=>{
            return reject(new Error(err));
         })
   })
}

// Get session data from file
function getUserData(user, field = false) {
    rawdata = fs.readFileSync(userdatajson);
    data = JSON.parse(rawdata);

    if (!data["users"][user]) {return false;}
    if (!field) {return data["users"][user];}
    if (!data["users"][user][field]) {return false;}
    else {return data["users"][user][field];}
}

// generic function to set user data in file
function setUserData(user, field, data) {
    let rawdata = fs.readFileSync(userdatajson);
    jsondata = JSON.parse(rawdata);

    if (!jsondata["users"][user]) {jsondata["users"][user] = {};}
    jsondata["users"][user][field] = data;

    console.log(JSON.stringify(jsondata));

    try {
        fs.writeFileSync(userdatajson, JSON.stringify(jsondata));
    } catch (err) {
        console.error(err);
        return false;
    }

    return true;
}

function translate(input, message) {
    userTranslation = getUserData(message.from, 'translation');

        if (typeof userTranslation === 'string') {
            runCompletion('translate the following text to ' + userTranslation + ':' + input).then(completion => {
                message.reply(completion);
            });
        } else {
            message.reply(input);
        }

}

// Toggle translation
function toggleTranslate(message) {
    // if message.body has 2 words, set translation to second word. else toggle translation
    if (message.body.split(' ').length == 2) {
        translation = message.body.split(' ')[1];
    } else {
        translation = !getUserData(message.from, 'translation');
    }

    // set translation
    setUserData(message.from, 'translation', translation);

    // send message
    if (translation === true) {
        message.reply('Translation is now enabled');
    } else if(typeof translation === 'string') {
        message.reply('Translation is now set to ' + translation);
    } else {
        message.reply('Translation is now disabled');
    }
}

// Get settings
function getUserSettings(user) {
    settings = getUserData(user);

    if (!settings) {
        settings = {
            "translation": false,
        }

        setUserData(user, 'translation', false);
    }

    return settings;
}

function reboothost() {
    //execute reboot command
    exec("sudo reboot", (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`stderr: ${stderr}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
    }
    );
}

// Restart app
function restartapp() {
    //execute restart command
    exec("pm2 restart index", (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`stderr: ${stderr}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
    }
    );
}
