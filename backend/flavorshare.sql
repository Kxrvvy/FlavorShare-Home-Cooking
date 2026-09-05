CREATE DATABASE IF NOT EXISTS flavorshare_db;
USE flavorshare_db;

SET FOREIGN_KEY_CHECKS = 0;

-- CAN STANDALONE
CREATE TABLE Users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM("guest", "registered", "admin") DEFAULT "registered",
    dietary_preferences TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Ingredient (
ingredient_id int auto_increment primary key,
name varchar(100) not null,
category varchar(50)
);

CREATE TABLE Tag (
tag_id int auto_increment primary key,
name varchar(50) not null unique
);

# DEPENDS ON USERS TABLE
CREATE TABLE Recipe (
recipe_id int auto_increment primary key,
user_id int not null,
title varchar(150) not null,
description text,
cuisine_type varchar(50),
prep_time int,
cook_time int,
servings int,
difficulty enum("easy", "medium", "hard"),
status enum("draft", "published") default "draft",
view_count int default 0,
created_at datetime default current_timestamp,
updated_at datetime default current_timestamp on update current_timestamp,
foreign key (user_id) references Users(user_id) on delete cascade
);

# DEPENDS ON RECIPE AND USERS
CREATE TABLE Step (
step_id int auto_increment primary key,
recipe_id int not null,
step_number int not null,
instruction text not null,
foreign key (recipe_id) references Recipe(recipe_id) on delete cascade
);

CREATE TABLE Image (
image_id int auto_increment primary key, 
recipe_id int not null,
uploaded_by int not null,
url varchar(255) not null,
type enum("ingredient", "step", "final") not null,
foreign key (recipe_id) references Recipe(recipe_id) on delete cascade,
FOREIGN KEY (uploaded_by) REFERENCES Users(user_id) ON DELETE CASCADE
);

CREATE TABLE Rating (
rating_id int auto_increment primary key,
recipe_id int not null,
user_id int not null,
score tinyint not null check (score between 1 and 5),
created_at datetime default current_timestamp,
foreign key (recipe_id) references Recipe(recipe_id) on delete cascade,
foreign key (user_id) references Users(user_id) on delete cascade,
unique (recipe_id, user_id)
);

-- FIX 1: renamed from "Comments" to "Comment" (singular) to match the ERD naming convention
CREATE TABLE Comment (
comment_id int auto_increment primary key,
recipe_id int not null,
user_id int not null,
content text not null,
created_at datetime default current_timestamp,
foreign key (recipe_id) references Recipe(recipe_id) on  delete cascade,
foreign key (user_id) references Users(user_id) on delete cascade
);

CREATE TABLE MealPlan (
    meal_plan_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    start_date DATE,
    end_date DATE,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

CREATE TABLE MealPlanEntry (
    meal_plan_entry_id INT AUTO_INCREMENT PRIMARY KEY,
    meal_plan_id INT NOT NULL,
    recipe_id INT NOT NULL,
    day VARCHAR(20),
    meal_type ENUM("breakfast", "lunch", "dinner", "snack"),
    FOREIGN KEY (meal_plan_id) REFERENCES MealPlan(meal_plan_id) ON DELETE CASCADE,
    FOREIGN KEY (recipe_id) REFERENCES Recipe(recipe_id) ON DELETE CASCADE
);

CREATE TABLE NutritionInfo (
    nutrition_info_id INT AUTO_INCREMENT PRIMARY KEY,
    recipe_id INT NOT NULL,
    calories DECIMAL(6,2),
    protein DECIMAL(6,2),
    carbs DECIMAL(6,2),
    fat DECIMAL(6,2),
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES Recipe(recipe_id) ON DELETE CASCADE
);

CREATE TABLE Activity (
    activity_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    recipe_id INT NULL,
    action_type VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (recipe_id) REFERENCES Recipe(recipe_id) ON DELETE SET NULL
);

-- --- JOIN TABLES (Many-to-Many Relationships) ---

-- FIX 2: quantity changed from VARCHAR(50) to DECIMAL(6,2) to match the ERD's
-- numeric intent and allow serving-size scaling/math later. If free-text amounts
-- like "a pinch" or "to taste" are needed, consider adding a separate nullable
-- `notes VARCHAR(50)` column instead of losing numeric quantity entirely.
CREATE TABLE RecipeIngredient (
    recipe_ingredient_id INT AUTO_INCREMENT PRIMARY KEY,
    recipe_id INT NOT NULL,
    ingredient_id INT NOT NULL,
    quantity DECIMAL(6,2),
    unit VARCHAR(30),
    FOREIGN KEY (recipe_id) REFERENCES Recipe(recipe_id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES Ingredient(ingredient_id) ON DELETE CASCADE
);

CREATE TABLE SavedRecipe (
    saved_recipe_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    recipe_id INT NOT NULL,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (recipe_id) REFERENCES Recipe(recipe_id) ON DELETE CASCADE
);

CREATE TABLE RecipeTag (
    recipe_tag_id INT AUTO_INCREMENT PRIMARY KEY,
    recipe_id INT NOT NULL,
    tag_id INT NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES Recipe(recipe_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES Tag(tag_id) ON DELETE CASCADE
);

-- Re-enable foreign key checks
-- FIX 3: added the matching SET FOREIGN_KEY_CHECKS = 0 at the top of this script
SET FOREIGN_KEY_CHECKS = 1;