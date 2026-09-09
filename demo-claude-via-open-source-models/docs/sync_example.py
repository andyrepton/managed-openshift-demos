import requests

def fetch_user(user_id):
    response = requests.get(f"https://api.example.com/users/{user_id}")
    return response.json()

def fetch_posts(user_id):
    response = requests.get(f"https://api.example.com/users/{user_id}/posts")
    return response.json()

def get_user_with_posts(user_id):
    user = fetch_user(user_id)
    posts = fetch_posts(user_id)
    user["posts"] = posts
    return user
