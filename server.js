import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { google } from "googleapis";
import { z } from "zod";
import axios from "axios";
import Groq from "groq-sdk";

dotenv.config();

const server = new McpServer({
    name: "Calender and Weather Services",
    version: "1.0.0",
});

// Initialize Google Auth
const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/calendar']
});

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

async function detectIntent(userInput) {
  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `Analyze the user's input and determine the intent. 
                   Possible intents: 
                   - 'calendar': Asking about calendar events
                   - 'weather': Asking about weather
                   - 'unknown': Can't determine intent
                   
                   Respond with ONLY the intent keyword.`
        },
        {
          role: "user",
          content: userInput
        }
      ],
      temperature: 0.0
    });


    return response.choices[0].message.content.trim().toLowerCase();
  } catch (err) {
    console.error("Intent detection error:", err);
    return "unknown";
  }
}

async function generateResponse(intent, rawData) {
  try {
    let prompt;
    
    if (intent === "calendar") {
      prompt = `Convert this calendar data into a natural language response:\n${JSON.stringify(rawData)}\n\nResponse:`;
    } else if (intent === "weather") {
      prompt = `Convert this weather data into a natural language response:\n${JSON.stringify(rawData)}\n\nResponse:`;
    } else {
      return "I couldn't process that request. Please try again.";
    }

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that converts raw API data into friendly, natural language responses."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7
    });

    return response.choices[0].message.content;
  } catch (err) {
    console.error("Text generation error:", err);
    return "I'm having trouble generating a response right now.";
  }
}

// Calendar Service
async function getMyCalendarDataByDate(date) {
    const calendar = google.calendar({
        version: "v3",
        auth
    });

    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    try {
        const res = await calendar.events.list({
            calendarId: process.env.CALENDAR_ID,
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            maxResults: 10,
            singleEvents: true,
            orderBy: "startTime",
        });

        const events = res.data.items || [];
        const meetings = events.map((event) => {
            const start = event.start.dateTime || event.start.date;
            return `${event.summary} at ${start}`;
        });

        return {
            meetings: meetings.length > 0 ? meetings : [],
        };
    } catch (err) {
        return {
            error: err.message,
        };
    }
}

// Weather Service
async function getWeatherForecast(location, days = 1) {
    try {
        const response = await axios.get(
            `https://api.weatherapi.com/v1/forecast.json?key=${process.env.WEATHER_API_KEY}&q=${location}&days=${days}`
        );
        
        const forecast = response.data.forecast.forecastday[0].day;
        return {
            location: response.data.location.name,
            condition: forecast.condition.text,
            temperature: `${forecast.avgtemp_c}°C`,
            max_temp: `${forecast.maxtemp_c}°C`,
            min_temp: `${forecast.mintemp_c}°C`,
            chance_of_rain: `${forecast.daily_chance_of_rain}%`,
        };
    } catch (err) {
        return {
            error: err.response?.data?.error?.message || err.message,
        };
    }
}

server.tool(
  "processUserRequest",
  {
    userInput: z.string().min(1, "Input is required"),
  },
  async ({ userInput }) => {
    try {
      const intent = await detectIntent(userInput);
      console.log(`Detected intent: ${intent}`);
      let serviceResponse;
      
      if (intent === "calendar") {
        let date;
        if (userInput.toLowerCase().includes('today')) {
          date = new Date().toISOString().split('T')[0];
        } else if (userInput.toLowerCase().includes('tomorrow')) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          date = tomorrow.toISOString().split('T')[0];
        } else {
          const dateMatch = userInput.match(/\d{4}-\d{2}-\d{2}/);
          date = dateMatch ? dateMatch[0] : new Date().toISOString().split('T')[0];
        }
        
        serviceResponse = await getMyCalendarDataByDate(date);
      } 
      else if (intent === "weather") {
        let location = "Dhaka"; // Default location
        const locationMatch = userInput.match(/in (.+?)(?: for|$| today| tomorrow)/i) || 
                             userInput.match(/weather (?:in|for|at) (.+?)(?:$| for| today| tomorrow)/i);
        
        if (locationMatch && locationMatch[1]) {
          location = locationMatch[1].trim();
        }
        
        serviceResponse = await getWeatherForecast(location);
      }
      else {
        return {
          content: [{
            type: "text",
            text: "I'm not sure what you're asking. I can help with calendar events or weather information."
          }]
        };
      }
      
      const response = await generateResponse(intent, serviceResponse);
      
      return {
        content: [{
          type: "text",
          text: response
        }]
      };
    } catch (error) {
      console.error("Error processing request:", error);
      return {
        content: [{
          type: "text",
          text: "Sorry, I encountered an error processing your request. Please try again."
        }]
      };
    }
  }
);

// Initialize server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
});

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});