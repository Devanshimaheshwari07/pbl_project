import sqlite3

conn = sqlite3.connect('database.db')

cursor = conn.cursor()

cursor.execute("SELECT id, name, email FROM user")

users = cursor.fetchall()

for user in users:
    print(f"ID: {user[0]}, Name: {user[1]}, Email: {user[2]}")


conn.close()
