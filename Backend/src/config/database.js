const path = require('path');
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const mongoose = require('mongoose');


async function connectDB() {

    try{

        await mongoose.connect(process.env.MONGO_URI )
        console.log('Connected to database successfully');
    }
    catch(err){
        console.error('Error connecting to MongoDB:', err);
    }

}

module.exports = connectDB;
