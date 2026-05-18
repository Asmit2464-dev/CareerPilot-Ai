const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const app = require('./src/app');
app.set("trust proxy", 1) // trust first proxy
const connectDB = require('./src/config/database');


connectDB();


const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
