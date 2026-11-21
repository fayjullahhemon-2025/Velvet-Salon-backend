import express from "express";
import cors from 'cors'
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv'
dotenv.config()

const app = express()
const port = process.env.PORT || 5000
//db connection
const client = new MongoClient(process.env.MONGODB_URL);
export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}
const connectedDB = await connectToMongoDB()
const db = connectedDB.db('Velvet-Saloon-DB')


app.get('/', (req, res) => {
    res.send('Velvet Saloon Server is running....')
})



















//app listen....
app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})