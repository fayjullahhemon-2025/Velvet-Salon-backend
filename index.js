import express from "express";
import cors from 'cors'
import { MongoClient } from "mongodb";
import dotenv from 'dotenv'
dotenv.config()

const app = express()
const port = process.env.PORT || 5000

app.get('/', (req, res) => {
    res.send('Velvet Saloon Server is running....')
})



















//app listen....
app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})